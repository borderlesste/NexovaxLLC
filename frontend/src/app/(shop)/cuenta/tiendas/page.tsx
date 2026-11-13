'use client';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { Store, Users } from 'lucide-react';
import { get } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Empty, PageLoader } from '@/components/ui/misc';
import { t } from '@/lib/i18n';

export default function FollowedStoresPage() {
  const q = useQuery({ queryKey: ['following'], queryFn: () => get('/me/following') });
  if (q.isLoading) return <PageLoader />;
  return (
    <div>
      <h1 className="text-3xl font-extrabold">{t('Mis tiendas')}</h1>
      <p className="text-muted">{t('Tiendas que sigues.')}</p>
      {!q.data?.length ? (
        <div className="card mt-6"><Empty icon={<Users />} title={t('No sigues ninguna tienda')} action={<Button asChild><Link href="/vendedores">{t('Descubrir tiendas')}</Link></Button>} /></div>
      ) : (
        <div className="mt-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {q.data.map((s: any) => (
            <Link key={s.id} href={`/tienda/${s.slug}`} className="card flex items-center gap-4 p-5 hover:shadow-lg">
              <div className="grid size-14 place-items-center overflow-hidden rounded-xl bg-brand-50">{s.logoUrl ? <img src={s.logoUrl} alt="" className="size-full object-cover" /> : <Store className="size-6 text-brand-600" />}</div>
              <div className="min-w-0"><p className="font-bold">{s.name}</p><p className="truncate text-sm text-muted">{s.shortDescription}</p></div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
