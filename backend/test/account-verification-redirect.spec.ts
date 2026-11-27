jest.mock('jose', () => ({ createRemoteJWKSet: () => ({}) }));
jest.mock('../src/common/password', () => ({ assertPasswordAcceptable: async () => undefined }));

import { AccountService } from '../src/account/account.service';

function fixture() {
  const pending: (() => Promise<unknown>)[] = [];
  const email = 'member@example.com';
  const db = { exec: jest.fn(), one: async () => ({ id: 'member' }) };
  const supabase = {
    createUser: async () => ({ id: 'member', email }),
    emailVerificationTokenHash: async () => 'confirmation+token',
  };
  const mail = { fire: (send: () => Promise<unknown>) => pending.push(send), emailVerification: jest.fn() };
  const policies = { acceptAccountPolicies: jest.fn() };
  const account = new AccountService(db as never, supabase as never, mail as never, policies as never, {} as never);

  const confirmationLink = async () => {
    await pending[0]();
    expect(mail.emailVerification).toHaveBeenCalledWith('member', email, expect.any(String));
    return new URL(mail.emailVerification.mock.calls[0][2]);
  };
  return { account, confirmationLink, email };
}

describe('verification link continuation', () => {
  it('preserves a same-site destination in the registration email', async () => {
    const { account, confirmationLink, email } = fixture();
    const next = '/vendedor/invitacion?token=fixture#aceptar';
    const result = await account.register({ fullName: 'Camila Rivera', email, password: 'Sample12345', acceptTerms: true, next });
    expect(result).toMatchObject({ confirmed: false, verificationSent: true });
    const link = await confirmationLink();
    expect(link.pathname).toBe('/auth/confirmar');
    expect(link.searchParams.get('token_hash')).toBe('confirmation+token');
    expect(link.searchParams.get('next')).toBe(next);
  });

  it('keeps the destination on resend', async () => {
    const { account, confirmationLink, email } = fixture();
    await account.resendVerification(email, '/checkout');
    expect((await confirmationLink()).searchParams.get('next')).toBe('/checkout');
  });

  it.each([undefined, '//example.com', '/catalogo/..//example.com', '/auth/bienvenida'])('omits an absent or unsuitable destination %s', async (next) => {
    const { account, confirmationLink, email } = fixture();
    await account.resendVerification(email, next);
    expect((await confirmationLink()).searchParams.has('next')).toBe(false);
  });
});
