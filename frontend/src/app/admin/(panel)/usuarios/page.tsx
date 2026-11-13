'use client';
import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Search, Shield, UserCog } from 'lucide-react';
import { toast } from 'sonner';
import { errorMessage, get, post } from '@/lib/api';
import { fmtDate } from '@/lib/utils';
import { PageHeader } from '@/components/layout/dashboard-shell';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input, Select } from '@/components/ui/input';
import { Badge, StatusBadge } from '@/components/ui/badge';
import { Avatar, Checkbox, Dialog, Empty, Pagination, Spinner } from '@/components/ui/misc';

const ROLES: [string, string][] = [['CUSTOMER', 'Comprador'], ['SELLER', 'Vendedor'], ['SUPPORT', 'Soporte'], ['MODERATOR', 'Moderador'], ['ADMIN', 'Administrador'], ['SUPER_ADMIN', 'Super admin']];

export default function UsersPage() {
  const qc = useQueryClient();
  const [search, setSearch] = useState('');
  const [role, setRole] = useState('');
  const [page, setPage] = useState(1);
  const [edit, setEdit] = useState<any>(null);
  const q = useQuery({ queryKey: ['admin-users', search, role, page], queryFn: () => get(`/admin/users?search=${encodeURIComponent(search)}&role=${role}&page=${page}`) });
  const toggle = async (r: string, grant: boolean) => {
    try {
      await post(`/admin/users/${edit.id}/roles`, { role: r, grant });
      setEdit({ ...edit, roles: grant ? [...edit.roles, r] : edit.roles.filter((x: string) => x !== r) });
      qc.invalidateQueries({ queryKey: ['admin-users'] });
    } catch (e) { toast.error(errorMessage(e)); }
  };
  const setStatus = async (status: string) => {
    try { await post(`/admin/users/${edit.id}/status`, { status }); setEdit({ ...edit, status }); qc.invalidateQueries({ queryKey: ['admin-users'] }); toast.success('Estado actualizado.'); } catch (e) { toast.error(errorMessage(e)); }
  };
  return (
    <>
      <PageHeader crumbs={[{ label: 'Panel' }, { label: 'Usuarios' }]} title="Usuarios" description="Consulta las cuentas y gestiona roles y permisos del equipo." />
      <Card>
        <div className="flex flex-wrap gap-3 p-4">
          <Input icon={<Search />} placeholder="Buscar por nombre o correo..." value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} className="max-w-sm" />
          <Select value={role} onChange={(e) => { setRole(e.target.value); setPage(1); }} className="w-48"><option value="">Rol: Todos</option>{ROLES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</Select>
        </div>
        {q.isLoading ? <div className="grid place-items-center py-10"><Spinner /></div> : !q.data?.items.length ? <Empty title="Sin usuarios" /> : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-sm">
              <thead className="bg-surface text-left text-xs font-semibold text-muted"><tr><th className="px-5 py-3">Usuario</th><th>Roles</th><th>Pedidos</th><th>Registro</th><th>Último acceso</th><th>Estado</th><th /></tr></thead>
              <tbody className="divide-y divide-line">{q.data.items.map((u: any) => (
                <tr key={u.id}><td className="px-5 py-3"><span className="flex items-center gap-3"><Avatar name={u.name} size={34} /><span><b>{u.name}</b><span className="block text-xs text-muted">{u.email}</span></span></span></td>
                  <td><span className="flex flex-wrap gap-1">{u.roles.map((r: string) => <Badge key={r} tone={['ADMIN', 'SUPER_ADMIN'].includes(r) ? 'red' : r === 'SELLER' ? 'green' : 'violet'}>{ROLES.find(([v]) => v === r)?.[1] ?? r}</Badge>)}</span></td>
                  <td>{u.orders}</td><td className="text-muted">{fmtDate(u.createdAt)}</td><td className="text-muted">{fmtDate(u.lastLoginAt)}</td><td><StatusBadge status={u.status} label={u.status === 'ACTIVE' ? 'Activo' : undefined} /></td>
                  <td className="pr-5 text-right"><Button size="sm" variant="secondary" onClick={() => setEdit(u)}><UserCog /> Gestionar</Button></td></tr>
              ))}</tbody>
            </table>
            <Pagination page={page} pageSize={25} total={q.data.total} onPage={setPage} label="usuarios" />
          </div>
        )}
      </Card>
      {edit && (
        <Dialog open onOpenChange={(o) => !o && setEdit(null)} title={edit.name} description={edit.email}>
          <p className="mb-2 flex items-center gap-2 font-bold"><Shield className="size-4 text-brand-600" /> Roles y permisos</p>
          <div className="grid gap-2 sm:grid-cols-2">{ROLES.map(([v, l]) => <Checkbox key={v} checked={edit.roles.includes(v)} onChange={(g) => toggle(v, g)} label={l} />)}</div>
          <div className="mt-5 flex items-center justify-between border-t border-line pt-4"><span className="text-sm">Estado de la cuenta: <StatusBadge status={edit.status} /></span>
            {edit.status === 'SUSPENDED' ? <Button size="sm" onClick={() => setStatus('ACTIVE')}>Reactivar</Button> : <Button size="sm" variant="danger" onClick={() => setStatus('SUSPENDED')}>Suspender cuenta</Button>}</div>
        </Dialog>
      )}
    </>
  );
}
