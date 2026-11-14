'use client';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { ChevronLeft } from 'lucide-react';
import { ReturnDetail } from '@/components/returns/returns';
import { t } from '@/lib/i18n';

export default function MyReturnPage() {
  const { id } = useParams<{ id: string }>();
  return (
    <div>
      <Link href="/cuenta/devoluciones" className="mb-4 inline-flex items-center gap-1 text-sm font-semibold text-muted hover:text-ink"><ChevronLeft className="size-4" /> {t('Mis devoluciones')}</Link>
      <ReturnDetail role="customer" id={id} />
    </div>
  );
}
