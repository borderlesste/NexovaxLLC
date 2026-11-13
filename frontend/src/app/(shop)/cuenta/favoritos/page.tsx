'use client';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { Heart } from 'lucide-react';
import { get } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Empty, PageLoader } from '@/components/ui/misc';
import { ProductCard } from '@/components/shop/product-card';
import { t } from '@/lib/i18n';

export default function FavoritesPage() {
  const q = useQuery({ queryKey: ['favorites'], queryFn: () => get('/me/favorites') });
  if (q.isLoading) return <PageLoader />;
  return (
    <div>
      <h1 className="text-3xl font-extrabold">{t('Mis favoritos')}</h1>
      <p className="text-muted">{t('Productos que guardaste para después.')}</p>
      {!q.data?.length ? (
        <div className="card mt-6"><Empty icon={<Heart />} title={t('Aún no tienes favoritos')} description={t('Toca el corazón en cualquier producto para guardarlo aquí.')} action={<Button asChild><Link href="/catalogo">{t('Explorar productos')}</Link></Button>} /></div>
      ) : (
        <div className="mt-6 grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-4">{q.data.map((p: any) => <ProductCard key={p.id} p={p} isFavorite showAddToCart />)}</div>
      )}
    </div>
  );
}
