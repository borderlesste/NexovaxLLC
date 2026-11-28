import { createClient } from '@supabase/supabase-js';
import { RequestUser } from '../src/auth/auth';
import { config } from '../src/config';
import { IdentityVerificationService } from '../src/seller/identity-verification.service';
import { SupabaseAdminService } from '../src/storage/supabase-admin.service';

const requestId = 'fixture-request';
const firstKey = 'fixture-store/first.pdf';
const secondKey = 'fixture-store/second.webp';

function fixture(status = 'APPROVED') {
  const first = { id: '10000000-0000-4000-8000-000000000001', storage_key: firstKey };
  const second = { id: '10000000-0000-4000-8000-000000000002', storage_key: secondKey };
  const pending = new Map([[first.id, first], [second.id, second]]);
  const audits: string[] = [];
  let purged = false;
  let due = status !== 'PENDING';
  const client = {};
  const db = {
    many: jest.fn(async (sql: string) => {
      if (sql.includes('from public.nx_identity_verification_files')) return [...pending.values()];
      if (sql.includes('from public.nx_identity_verification_requests')) return due && !purged ? [{ id: requestId }] : [];
      throw new Error('Unexpected list query');
    }),
    one: jest.fn(async (sql: string) => {
      if (sql.includes('for update')) return due && !purged ? { id: requestId } : null;
      if (sql.includes("set status = 'CANCELLED'")) {
        expect(sql).toContain('files_purge_after = now()');
        due = true;
        return { id: requestId };
      }
      if (sql.includes('from public.sellers')) return { identity_verified_at: null };
      return null;
    }),
    exec: jest.fn(async (sql: string, params: unknown[], tx?: object) => {
      if (sql.includes('set deleted_at')) {
        expect(tx).toBe(client);
        expect(sql).toContain('id = any($2::uuid[])');
        expect(params[0]).toBe(requestId);
        for (const id of params[1] as string[]) pending.delete(id);
        return 1;
      }
      if (sql.includes('set files_purged_at')) {
        expect(tx).toBe(client);
        expect(sql).toContain('and not exists');
        expect(sql).toContain('files_purged_at is null');
        if (pending.size || purged) return 0;
        purged = true;
        return 1;
      }
      if (sql.includes('insert into public.nx_identity_verification_log')) {
        if (params[3] === 'PURGE_FILES') expect(tx).toBe(client);
        audits.push(params[3] as string);
        return 1;
      }
      throw new Error('Unexpected write query');
    }),
    tx: jest.fn(async (fn: (c: object) => Promise<boolean>) => fn(client)),
  };
  const present = new Set([firstKey, secondKey]);
  const remove = jest.fn(async ([key]: [string]): Promise<{ data: { name: string }[] | null; error: object | null }> => {
    const removed = present.delete(key);
    return { data: removed ? [{ name: key }] : [], error: null };
  });
  const info = jest.fn(async (key: string): Promise<{ error: object | null }> => ({
    error: present.has(key) ? null : { status: 404, code: 'NoSuchKey' },
  }));
  const from = jest.fn(() => ({ remove, info }));
  const storage: SupabaseAdminService = Object.assign(Object.create(SupabaseAdminService.prototype), {
    client: { storage: { from } },
  });
  const service = new IdentityVerificationService(db as never, storage, {} as never, {} as never);
  return { service, storage, db, first, second, pending, audits, present, from, remove, info, get purged() { return purged; } };
}

describe('retry-safe seller identity document purge (synthetic objects)', () => {
  it('keeps the failed file pending, records partial success, and counts completion only on retry', async () => {
    const f = fixture();
    f.remove.mockResolvedValueOnce({ data: null, error: { code: 'InternalError' } });

    expect(await f.service.purgeExpired()).toBe(0);
    expect([...f.pending.keys()]).toEqual([f.first.id]);
    expect(f.purged).toBe(false);
    expect(f.audits).toEqual([]);
    expect(f.from).toHaveBeenCalledWith(config.identityBucket);

    expect(await f.service.purgeExpired()).toBe(1);
    expect(f.remove.mock.calls).toEqual([[[firstKey]], [[secondKey]], [[firstKey]]]);
    expect(f.pending.size).toBe(0);
    expect(f.purged).toBe(true);
    expect(f.audits).toEqual(['PURGE_FILES']);
    expect(await f.service.purgeExpired()).toBe(0);
    expect(f.audits).toEqual(['PURGE_FILES']);
  });

  it('keeps cancellation due and retries a transport failure in the scheduled job', async () => {
    const f = fixture('PENDING');
    expect(await f.service.purgeExpired()).toBe(0);
    expect(f.remove).not.toHaveBeenCalled();
    f.remove.mockRejectedValueOnce(new Error('Synthetic storage timeout'));
    await f.service.cancel({ id: 'fixture-user' } as RequestUser, 'fixture-store');
    expect([...f.pending.keys()]).toEqual([f.first.id]);
    expect(f.audits).toEqual(['CANCEL']);
    expect(await f.service.purgeExpired()).toBe(1);
    expect(f.audits).toEqual(['CANCEL', 'PURGE_FILES']);
  });

  it('recovers when an earlier deletion succeeded but the database did not record it', async () => {
    const f = fixture();
    f.db.tx.mockRejectedValueOnce(new Error('Synthetic DB failure'));
    expect(await f.service.purgeExpired()).toBe(0);
    expect(f.present.size).toBe(0);
    expect(f.pending.size).toBe(2);
    expect(f.audits).toEqual([]);
    expect(await f.service.purgeExpired()).toBe(1);
    expect(f.info.mock.calls).toEqual([[firstKey], [secondKey]]);
    expect(f.audits).toEqual(['PURGE_FILES']);
  });

  it.each([
    ['wrong file in response, target still present', null],
    ['missing bucket', { code: 'NoSuchBucket' }],
    ['unqualified 404', { status: 404 }],
    ['lookup forbidden', { status: 403, code: 'AccessDenied' }],
    ['wrong status for a missing-object error', { status: 500, code: 'NoSuchKey' }],
  ])('does not count %s as deletion', async (_description, error) => {
    const f = fixture();
    f.remove.mockResolvedValueOnce({ data: [{ name: 'fixture-store/unrelated.pdf' }], error: null });
    f.info.mockResolvedValueOnce({ error });
    expect(await f.service.purgeExpired()).toBe(0);
    expect([...f.pending.keys()]).toEqual([f.first.id]);
    expect(f.audits).toEqual([]);
  });

  it('recognizes an explicit missing-object response through the pinned Storage SDK', async () => {
    const fetchStorage = jest.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === 'DELETE') return Response.json([]);
      return Response.json({ code: 'NoSuchKey', message: 'Synthetic missing object' }, { status: 404 });
    });
    const storage: SupabaseAdminService = Object.assign(Object.create(SupabaseAdminService.prototype), {
      client: createClient('https://fixture.supabase.co', 'synthetic-service-key', {
        global: { fetch: fetchStorage },
      }),
    });
    await expect(storage.purgeIdentityObject(firstKey)).resolves.toBe(true);
    expect(fetchStorage).toHaveBeenCalledTimes(2);
  });

  it('still completes a request when both files are confirmed in the first run', async () => {
    const f = fixture();
    expect(await f.service.purgeExpired()).toBe(1);
    expect(f.info).not.toHaveBeenCalled();
    expect(f.audits).toEqual(['PURGE_FILES']);
  });
});
