'use client';
import Link from 'next/link';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { BadgeCheck, ChevronRight, FileText } from 'lucide-react';
import { get } from '@/lib/api';
import { countryName, t } from '@/lib/i18n';
import { fmtDateTime } from '@/lib/utils';
import { PageHeader } from '@/components/layout/dashboard-shell';
import { Card } from '@/components/ui/card';
import { Empty, PageLoader, Segmented } from '@/components/ui/misc';
import { idDocTypeLabel, idRejectionLabel } from '@/lib/identity-verification';

type Status = 'PENDING' | 'APPROVED' | 'REJECTED' | 'CANCELLED';

/** Administrators only: «Identidad verificada» requests, oldest pending first. */
export default function IdentityQueuePage() {
  const [status, setStatus] = useState<Status>('PENDING');
  const q = useQuery({ queryKey: ['admin-identity', status], queryFn: () => get(`/admin/identity-verifications?status=${status}`) });
  return (
    <>
      <PageHeader crumbs={[{ label: t('Vendedores'), href: '/admin/vendedores' }, { label: t('Verificación de identidad') }]} title={t('Verificación de identidad')}
        description={t('Solicitudes de la insignia «Identidad verificada». Solo los administradores ven los documentos; cada vez que se abre un archivo queda registrado.')} />
      <Card>
        <Segmented className="px-3" value={status} onChange={setStatus} options={[
          { value: 'PENDING', label: t('En revisión'), count: q.data?.counts?.pending },
          { value: 'APPROVED', label: t('Aprobadas') },
          { value: 'REJECTED', label: t('Rechazadas') },
          { value: 'CANCELLED', label: t('Canceladas') },
        ]} />
        {q.isLoading ? <PageLoader /> : q.data?.items?.length ? (
          <ul className="divide-y divide-line">
            {q.data.items.map((r: any) => (
              <li key={r.id}>
                <Link href={`/admin/identidad/${r.id}`} className="flex flex-wrap items-center gap-3 px-5 py-4 hover:bg-surface">
                  <BadgeCheck className="size-5 shrink-0 text-brand-600" />
                  <div className="min-w-0 flex-1">
                    <p className="font-bold">{r.store}{r.legalName ? <span className="font-normal text-muted"> · {r.legalName}</span> : null}{r.countryCode ? <span className="font-normal text-muted"> · {countryName(r.countryCode)}</span> : null}</p>
                    <p className="text-sm text-muted">{idDocTypeLabel(r.documentType)} · <FileText className="inline size-3.5" /> {r.files}</p>
                    {r.status === 'REJECTED' && <p className="text-xs text-red-600">{idRejectionLabel(r.rejectionReason)}</p>}
                  </div>
                  <div className="text-right text-xs text-muted">
                    <p>{t('Enviada el {d}', { d: fmtDateTime(r.createdAt) })}</p>
                    {r.reviewedAt && <p>{t('Revisada el {d} por {who}', { d: fmtDateTime(r.reviewedAt), who: r.reviewer ?? '—' })}</p>}
                    {r.filesPurgedAt && <p>{t('Archivos borrados')}</p>}
                  </div>
                  <ChevronRight className="size-4 text-muted" />
                </Link>
              </li>
            ))}
          </ul>
        ) : <Empty icon={<BadgeCheck />} title={status === 'PENDING' ? t('No hay solicitudes pendientes') : t('No hay solicitudes')} />}
      </Card>
    </>
  );
}
