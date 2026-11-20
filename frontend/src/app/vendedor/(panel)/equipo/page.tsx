'use client';
import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Mail, Pencil, Plus, Trash2, UserMinus, Users } from 'lucide-react';
import { toast } from 'sonner';
import { del, errorMessage, get, post, put } from '@/lib/api';
import { fmtDate } from '@/lib/utils';
import { t } from '@/lib/i18n';
import type { SellerArea } from '@/lib/auth';
import { PageHeader } from '@/components/layout/dashboard-shell';
import { Card, CardHeader } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Field, Input } from '@/components/ui/input';
import { Avatar, Dialog, Empty, PageLoader } from '@/components/ui/misc';

const AREAS: { code: SellerArea; label: string; hint: string }[] = [
  { code: 'PRODUCTS', label: 'Productos e inventario', hint: 'Crear y editar productos, fotos y stock.' },
  { code: 'ORDERS', label: 'Pedidos, envíos y devoluciones', hint: 'Preparar y enviar pedidos, cancelaciones y devoluciones.' },
  { code: 'MESSAGES', label: 'Mensajes', hint: 'Responder a los compradores.' },
  { code: 'MARKETING', label: 'Cupones, ofertas y afiliados', hint: 'Crear cupones y enviar ofertas.' },
  { code: 'FINANCE', label: 'Finanzas (solo consulta)', hint: 'Ver saldo, movimientos y retiros. No puede cobrar ni cambiar cuentas.' },
  { code: 'STATS', label: 'Dashboard y estadísticas', hint: 'Ver ventas y rendimiento de la tienda.' },
  { code: 'SETTINGS', label: 'Configuración de la tienda', hint: 'Editar perfil público, logo y dirección de envío.' },
];
const areaLabel = (a: string) => t(AREAS.find((x) => x.code === a)?.label ?? a);

type Team = {
  owner: { userId: string; email: string; name: string } | null;
  members: { id: string; email: string; name: string; status: 'ACTIVE' | 'SUSPENDED'; areas: SellerArea[]; joinedAt: string }[];
  invitations: { id: string; email: string; areas: SellerArea[]; expiresAt: string }[];
};

function AreaPicker({ value, onChange }: { value: SellerArea[]; onChange: (v: SellerArea[]) => void }) {
  return (
    <div className="grid gap-2">
      {AREAS.map((a) => (
        <label key={a.code} className="flex cursor-pointer items-start gap-3 rounded-xl border border-line p-3 hover:bg-surface">
          <input
            type="checkbox"
            checked={value.includes(a.code)}
            onChange={(e) => onChange(e.target.checked ? [...value, a.code] : value.filter((x) => x !== a.code))}
            className="mt-0.5 size-4 shrink-0 rounded border-line accent-brand-600"
          />
          <span className="min-w-0">
            <span className="block text-sm font-semibold">{t(a.label)}</span>
            <span className="block text-xs text-muted">{t(a.hint)}</span>
          </span>
        </label>
      ))}
    </div>
  );
}

export default function TeamPage() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['seller-team'], queryFn: () => get<Team>('/seller/team') });
  const refresh = () => qc.invalidateQueries({ queryKey: ['seller-team'] });
  const [invite, setInvite] = useState<null | { email: string; areas: SellerArea[] }>(null);
  const [edit, setEdit] = useState<null | { id: string; name: string; areas: SellerArea[] }>(null);
  const [busy, setBusy] = useState(false);

  const run = async (fn: () => Promise<unknown>, ok: string) => {
    setBusy(true);
    try {
      await fn();
      toast.success(ok);
      refresh();
      return true;
    } catch (e) {
      toast.error(errorMessage(e));
      return false;
    } finally {
      setBusy(false);
    }
  };

  if (q.isLoading) return <PageLoader />;
  const d = q.data;
  const people = (d?.members.length ?? 0) + (d?.invitations.length ?? 0);

  return (
    <div>
      <PageHeader
        title="Equipo"
        description="Invita a personas para que te ayuden con la tienda y elige qué secciones pueden usar."
        actions={<Button onClick={() => setInvite({ email: '', areas: ['ORDERS'] })}><Plus /> {t('Invitar persona')}</Button>}
      />

      <Card>
        <CardHeader icon={<Users />} title={t('Miembros')} subtitle={t('Los métodos de cobro, los retiros y el equipo siempre quedan solo para ti.')} />
        <div className="divide-y divide-line">
          {d?.owner && (
            <div className="flex flex-wrap items-center gap-3 px-5 py-4">
              <Avatar name={d.owner.name} size={40} />
              <div className="min-w-0 flex-1">
                <p className="truncate font-semibold">{d.owner.name}</p>
                <p className="truncate text-xs text-muted">{d.owner.email}</p>
              </div>
              <Badge tone="violet">{t('Propietario')}</Badge>
            </div>
          )}
          {d?.members.map((m) => (
            <div key={m.id} className="flex flex-wrap items-center gap-3 px-5 py-4">
              <Avatar name={m.name} size={40} />
              <div className="min-w-0 flex-1">
                <p className="truncate font-semibold">{m.name}</p>
                <p className="truncate text-xs text-muted">{m.email} · {t('desde {a}', { a: fmtDate(m.joinedAt) })}</p>
                <div className="mt-1.5 flex flex-wrap gap-1">
                  {m.areas.map((a) => <Badge key={a} tone="gray">{areaLabel(a)}</Badge>)}
                </div>
              </div>
              {m.status === 'SUSPENDED' && <Badge tone="amber">{t('Suspendido')}</Badge>}
              <div className="flex gap-1">
                <Button variant="ghost" size="sm" onClick={() => setEdit({ id: m.id, name: m.name, areas: m.areas })} aria-label={t('Editar')}><Pencil /></Button>
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={busy}
                  onClick={() => run(() => put(`/seller/team/members/${m.id}`, { status: m.status === 'SUSPENDED' ? 'ACTIVE' : 'SUSPENDED' }), m.status === 'SUSPENDED' ? t('Acceso reactivado') : t('Acceso suspendido'))}
                >
                  {m.status === 'SUSPENDED' ? t('Reactivar') : t('Suspender')}
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={busy}
                  className="text-red-600"
                  aria-label={t('Quitar del equipo')}
                  onClick={() => window.confirm(t('¿Quitar a {a} del equipo? Perderá el acceso a la tienda de inmediato.', { a: m.name })) && run(() => del(`/seller/team/members/${m.id}`), t('Miembro eliminado'))}
                >
                  <UserMinus />
                </Button>
              </div>
            </div>
          ))}
          {!d?.members.length && (
            <Empty icon={<Users />} title={t('Todavía trabajas solo')} description={t('Invita a alguien de confianza para que prepare pedidos, responda mensajes o cargue productos.')} />
          )}
        </div>
      </Card>

      {!!d?.invitations.length && (
        <Card className="mt-5">
          <CardHeader icon={<Mail />} title={t('Invitaciones pendientes')} subtitle={t('Cada invitación vence a los 7 días. Puedes volver a enviarla si no llegó.')} />
          <div className="divide-y divide-line">
            {d.invitations.map((i) => (
              <div key={i.id} className="flex flex-wrap items-center gap-3 px-5 py-4">
                <div className="min-w-0 flex-1">
                  <p className="truncate font-semibold">{i.email}</p>
                  <p className="text-xs text-muted">{t('Vence el {a}', { a: fmtDate(i.expiresAt) })}</p>
                  <div className="mt-1.5 flex flex-wrap gap-1">
                    {i.areas.map((a) => <Badge key={a} tone="gray">{areaLabel(a)}</Badge>)}
                  </div>
                </div>
                <div className="flex gap-1">
                  <Button variant="ghost" size="sm" disabled={busy} onClick={() => run(() => post('/seller/team/invitations', { email: i.email, areas: i.areas }), t('Invitación reenviada'))}>{t('Reenviar')}</Button>
                  <Button variant="ghost" size="sm" disabled={busy} className="text-red-600" aria-label={t('Cancelar invitación')} onClick={() => run(() => del(`/seller/team/invitations/${i.id}`), t('Invitación cancelada'))}><Trash2 /></Button>
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}

      <p className="mt-4 text-xs text-muted">{t('{a} de 25 personas.', { a: people })}</p>

      <Dialog
        open={!!invite}
        onOpenChange={(o) => !o && setInvite(null)}
        title={t('Invitar persona')}
        description={t('Le enviaremos un correo. Debe iniciar sesión o crear su cuenta con ese mismo correo para aceptar.')}
        footer={
          <>
            <Button variant="outline" onClick={() => setInvite(null)}>{t('Cancelar')}</Button>
            <Button
              loading={busy}
              disabled={!invite?.email.trim() || !invite?.areas.length}
              onClick={async () => (await run(() => post('/seller/team/invitations', { email: invite!.email.trim(), areas: invite!.areas }), t('Invitación enviada'))) && setInvite(null)}
            >
              {t('Enviar invitación')}
            </Button>
          </>
        }
      >
        {invite && (
          <div className="space-y-4">
            <Field label={t('Correo electrónico')} required>
              <Input type="email" value={invite.email} onChange={(e) => setInvite({ ...invite, email: e.target.value })} placeholder="persona@ejemplo.com" autoFocus />
            </Field>
            <Field label={t('Qué puede hacer')} required>
              <AreaPicker value={invite.areas} onChange={(areas) => setInvite({ ...invite, areas })} />
            </Field>
          </div>
        )}
      </Dialog>

      <Dialog
        open={!!edit}
        onOpenChange={(o) => !o && setEdit(null)}
        title={edit ? t('Permisos de {a}', { a: edit.name }) : ''}
        footer={
          <>
            <Button variant="outline" onClick={() => setEdit(null)}>{t('Cancelar')}</Button>
            <Button loading={busy} disabled={!edit?.areas.length} onClick={async () => (await run(() => put(`/seller/team/members/${edit!.id}`, { areas: edit!.areas }), t('Permisos actualizados'))) && setEdit(null)}>
              {t('Guardar')}
            </Button>
          </>
        }
      >
        {edit && <AreaPicker value={edit.areas} onChange={(areas) => setEdit({ ...edit, areas })} />}
      </Dialog>
    </div>
  );
}
