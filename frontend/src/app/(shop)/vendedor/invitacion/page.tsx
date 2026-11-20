'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, Store, XCircle } from 'lucide-react';
import { toast } from 'sonner';
import { errorMessage, get, post } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { t } from '@/lib/i18n';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { PageLoader } from '@/components/ui/misc';

const LABEL: Record<string, string> = {
  PRODUCTS: 'Productos e inventario',
  ORDERS: 'Pedidos, envíos y devoluciones',
  MESSAGES: 'Mensajes',
  MARKETING: 'Cupones, ofertas y afiliados',
  FINANCE: 'Finanzas (solo consulta)',
  STATS: 'Dashboard y estadísticas',
  SETTINGS: 'Configuración de la tienda',
};

/** Landing page of the team invitation e-mail: sign in with the invited address and accept. */
export default function TeamInvitationPage() {
  const { session, loading, me, selectSeller, signOut } = useAuth();
  const router = useRouter();
  const qc = useQueryClient();
  const [token, setToken] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => setToken(new URLSearchParams(window.location.search).get('token') ?? ''), []);
  const preview = useQuery({
    queryKey: ['team-invitation', token, me?.id],
    queryFn: () => get<{ store: string; email: string; areas: string[]; status: string; emailMatches: boolean }>(`/team/invitations/preview?token=${encodeURIComponent(token!)}`),
    enabled: !!token && !!session,
    retry: false,
  });

  if (loading || token === null) return <PageLoader />;
  const here = `/vendedor/invitacion?token=${encodeURIComponent(token)}`;

  const box = (children: React.ReactNode) => (
    <div className="mx-auto max-w-lg px-4 py-14">
      <div className="card p-6 text-center sm:p-8">{children}</div>
    </div>
  );

  if (!token) return box(<p className="text-muted">{t('El enlace de invitación no es válido.')}</p>);

  if (!session)
    return box(
      <>
        <div className="mx-auto mb-4 grid size-14 place-items-center rounded-2xl bg-brand-50 text-brand-600"><Store className="size-7" /></div>
        <h1 className="text-xl font-extrabold">{t('Te invitaron al equipo de una tienda')}</h1>
        <p className="mt-2 text-sm text-muted">{t('Inicia sesión o crea tu cuenta con el mismo correo que recibió la invitación para aceptarla.')}</p>
        <div className="mt-6 grid gap-2 sm:grid-cols-2">
          <Button asChild><Link href={`/auth/iniciar-sesion?next=${encodeURIComponent(here)}`}>{t('Iniciar sesión')}</Link></Button>
          <Button variant="outline" asChild><Link href={`/auth/registrarse?next=${encodeURIComponent(here)}`}>{t('Crear cuenta')}</Link></Button>
        </div>
      </>,
    );

  if (preview.isLoading) return <PageLoader />;
  if (preview.error || !preview.data)
    return box(
      <>
        <XCircle className="mx-auto mb-3 size-10 text-red-500" />
        <p className="font-semibold">{preview.error ? errorMessage(preview.error) : t('Invitación no encontrada.')}</p>
      </>,
    );

  const inv = preview.data;
  if (inv.status !== 'PENDING')
    return box(
      <>
        <XCircle className="mx-auto mb-3 size-10 text-amber-500" />
        <p className="font-semibold">
          {inv.status === 'EXPIRED' ? t('Esta invitación venció. Pide al propietario que te envíe otra.') : t('Esta invitación ya fue usada o cancelada.')}
        </p>
        <Button className="mt-5" variant="outline" asChild><Link href="/vendedor/dashboard">{t('Ir al panel del vendedor')}</Link></Button>
      </>,
    );

  const accept = async () => {
    setBusy(true);
    try {
      const r = await post<{ sellerId: string; store: string }>('/team/invitations/accept', { token });
      await qc.invalidateQueries({ queryKey: ['me'] });
      selectSeller(r.sellerId);
      toast.success(t('Ya eres parte del equipo de {a}', { a: r.store }));
      router.push('/vendedor/dashboard');
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return box(
    <>
      <div className="mx-auto mb-4 grid size-14 place-items-center rounded-2xl bg-brand-50 text-brand-600"><Store className="size-7" /></div>
      <h1 className="text-xl font-extrabold">{t('Únete al equipo de {a}', { a: inv.store })}</h1>
      <p className="mt-2 text-sm text-muted">{t('Podrás trabajar en estas secciones de la tienda:')}</p>
      <div className="mt-4 flex flex-wrap justify-center gap-1.5">
        {inv.areas.map((a) => <Badge key={a} tone="blue">{t(LABEL[a] ?? a)}</Badge>)}
      </div>
      {inv.emailMatches ? (
        <Button className="mt-6 w-full" loading={busy} onClick={accept}><CheckCircle2 /> {t('Aceptar invitación')}</Button>
      ) : (
        <div className="mt-6 rounded-xl bg-amber-50 p-4 text-left text-sm text-amber-800">
          <p>{t('Esta invitación es para {a}, pero iniciaste sesión como {b}.', { a: inv.email, b: me?.email ?? '' })}</p>
          <Button className="mt-3" variant="outline" size="sm" onClick={() => signOut()}>{t('Cerrar sesión y cambiar de cuenta')}</Button>
        </div>
      )}
    </>,
  );
}
