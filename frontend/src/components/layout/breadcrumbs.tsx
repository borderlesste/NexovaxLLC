import Link from 'next/link';
import { ChevronRight, Home } from 'lucide-react';

export function Breadcrumbs({ items }: { items: { label: string; href?: string }[] }) {
  return (
    <nav aria-label="Ruta" className="flex flex-wrap items-center gap-1.5 text-sm text-muted">
      <Link href="/" aria-label="Inicio" className="hover:text-ink"><Home className="size-4" /></Link>
      {items.map((it, i) => (
        <span key={i} className="flex items-center gap-1.5">
          <ChevronRight className="size-3.5" />
          {it.href && i < items.length - 1 ? (
            <Link href={it.href} className="hover:text-ink">{it.label}</Link>
          ) : (
            <span className="font-semibold text-ink">{it.label}</span>
          )}
        </span>
      ))}
    </nav>
  );
}
