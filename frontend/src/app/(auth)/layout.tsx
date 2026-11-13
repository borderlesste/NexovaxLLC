import Link from 'next/link';
import { BookOpen, HelpCircle, Store } from 'lucide-react';
import { Logo } from '@/components/layout/logo';

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-dvh bg-gradient-to-br from-surface via-white to-brand-50">
      <header className="border-b border-line bg-white">
        <div className="mx-auto flex h-20 max-w-[1400px] items-center justify-between px-4 lg:px-10">
          <Logo />
          <nav className="flex items-center gap-2 text-sm font-medium sm:gap-5">
            <Link href="/ayuda" className="hidden items-center gap-2 text-ink hover:text-brand-700 sm:flex"><HelpCircle className="size-5" /> Centro de ayuda</Link>
            <Link href="/ayuda#guias" className="hidden items-center gap-2 text-ink hover:text-brand-700 md:flex"><BookOpen className="size-5" /> Guías</Link>
            <span className="hidden h-8 w-px bg-line sm:block" />
            <Link href="/vendedor/registro" className="flex items-center gap-2 rounded-xl bg-brand-50 px-4 py-2.5 font-semibold text-brand-700 hover:bg-brand-100"><Store className="size-5" /> Vender en el marketplace</Link>
          </nav>
        </div>
      </header>
      <main className="px-4 py-10 lg:py-14">{children}</main>
    </div>
  );
}
