'use client';
import Link from 'next/link';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { BadgeCheck, Box, Search, Star, Store } from 'lucide-react';
import { get } from '@/lib/api';
import { Breadcrumbs } from '@/components/layout/breadcrumbs';
import { Input } from '@/components/ui/input';
import { Empty, Skeleton } from '@/components/ui/misc';
import { LogoMark } from '@/components/layout/logo';
import { Button } from '@/components/ui/button';

export default function SellersPage() {
  const [q, setQ] = useState('');
  const sellers = useQuery({ queryKey: ['sellers', q], queryFn: () => get(`/sellers?q=${encodeURIComponent(q)}`) });
  return (
    <div className="mx-auto max-w-[1400px] px-4 py-6 lg:px-8">
      <Breadcrumbs items={[{ label: 'Vendedores' }]} />
      <div className="mt-4 flex flex-wrap items-end justify-between gap-4">
        <div><h1 className="text-3xl font-extrabold">Tiendas del marketplace</h1><p className="text-muted">Descubre vendedores dominicanos verificados.</p></div>
        <Input icon={<Search />} placeholder="Buscar tienda…" value={q} onChange={(e) => setQ(e.target.value)} className="w-72" />
      </div>
      <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {sellers.isLoading && Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="h-48" />)}
        {sellers.data?.map((s: any) => (
          <Link key={s.id} href={`/tienda/${s.slug}`} className="card flex flex-col items-center p-6 text-center transition hover:-translate-y-0.5 hover:shadow-lg">
            <div className="grid size-20 place-items-center overflow-hidden rounded-2xl bg-brand-50">{s.logoUrl ? <img src={s.logoUrl} alt={s.name} className="size-full object-cover" /> : <LogoMark className="size-10" />}</div>
            <p className="mt-3 flex items-center gap-1 text-lg font-bold">{s.name} {s.verified && <BadgeCheck className="size-5 fill-brand-600 text-white" />}</p>
            {s.shortDescription && <p className="mt-1 line-clamp-2 text-sm text-muted">{s.shortDescription}</p>}
            <div className="mt-3 flex gap-4 text-sm text-muted">
              <span className="inline-flex items-center gap-1"><Star className="size-4 fill-amber-400 text-amber-400" /> {s.rating ? s.rating.toFixed(1) : '—'}</span>
              <span className="inline-flex items-center gap-1"><Box className="size-4" /> {s.products} productos</span>
            </div>
          </Link>
        ))}
      </div>
      {sellers.data?.length === 0 && <div className="card mt-6"><Empty icon={<Store />} title="No encontramos tiendas" action={<Button asChild><Link href="/vendedor/registro">Abre tu tienda</Link></Button>} /></div>}
    </div>
  );
}
