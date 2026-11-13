import Link from 'next/link';
import { Logo } from './logo';


const Social = {
  facebook: <svg viewBox="0 0 24 24" className="size-5" fill="currentColor" aria-hidden><path d="M13.5 21v-7.5h2.5l.4-3h-2.9V8.6c0-.9.3-1.5 1.5-1.5h1.6V4.4c-.3 0-1.2-.1-2.3-.1-2.3 0-3.8 1.4-3.8 3.9v2.3H8v3h2.5V21h3z"/></svg>,
  instagram: <svg viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden><rect x="3" y="3" width="18" height="18" rx="5"/><circle cx="12" cy="12" r="4"/><circle cx="17.5" cy="6.5" r="1" fill="currentColor"/></svg>,
  youtube: <svg viewBox="0 0 24 24" className="size-5" fill="currentColor" aria-hidden><path d="M21.6 7.2a2.5 2.5 0 0 0-1.8-1.8C18.2 5 12 5 12 5s-6.2 0-7.8.4A2.5 2.5 0 0 0 2.4 7.2 26 26 0 0 0 2 12a26 26 0 0 0 .4 4.8 2.5 2.5 0 0 0 1.8 1.8C5.8 19 12 19 12 19s6.2 0 7.8-.4a2.5 2.5 0 0 0 1.8-1.8A26 26 0 0 0 22 12a26 26 0 0 0-.4-4.8zM10 15V9l5.2 3L10 15z"/></svg>,
};

const cols = [
  { title: 'Marketplace', links: [['Inicio', '/'], ['Categorías', '/catalogo'], ['Ofertas', '/catalogo?onSale=true'], ['Vendedores', '/vendedores']] },
  { title: 'Vendedores', links: [['Vender en la plataforma', '/vendedor/registro'], ['Planes y comisiones', '/ayuda#comisiones'], ['Ayuda para vendedores', '/ayuda#vendedores']] },
  { title: 'Ayuda', links: [['Centro de ayuda', '/ayuda'], ['Preguntas frecuentes', '/ayuda#faq'], ['Reportar un problema', '/ayuda/reportar']] },
];

export function ShopFooter() {
  return (
    <footer className="mt-16 bg-brand-950 text-brand-100">
      <div className="mx-auto grid max-w-[1400px] gap-10 px-4 py-12 md:grid-cols-[1.4fr_repeat(3,1fr)_auto] lg:px-8">
        <div>
          <Logo invert />
          <p className="mt-4 max-w-xs text-sm text-brand-200">El marketplace dominicano que conecta compradores y vendedores en un solo lugar.</p>
        </div>
        {cols.map((c) => (
          <div key={c.title}>
            <p className="mb-3 font-bold text-white">{c.title}</p>
            <ul className="space-y-1.5 text-sm">
              {c.links.map(([l, h]) => (
                <li key={l}><Link href={h} className="text-brand-200 hover:text-white">{l}</Link></li>
              ))}
            </ul>
          </div>
        ))}
        <div>
          <p className="mb-3 font-bold text-white">Síguenos</p>
          <div className="flex gap-3 text-brand-200">
            <a href="https://facebook.com" target="_blank" rel="noreferrer" aria-label="Facebook" className="hover:text-white">{Social.facebook}</a>
            <a href="https://instagram.com" target="_blank" rel="noreferrer" aria-label="Instagram" className="hover:text-white">{Social.instagram}</a>
            <a href="https://youtube.com" target="_blank" rel="noreferrer" aria-label="YouTube" className="hover:text-white">{Social.youtube}</a>
          </div>
        </div>
      </div>
      <div className="border-t border-white/10">
        <div className="mx-auto flex max-w-[1400px] flex-wrap justify-between gap-2 px-4 py-4 text-xs text-brand-300 lg:px-8">
          <span>© {new Date().getFullYear()} RD Marketplace. Todos los derechos reservados.</span>
          <span className="flex gap-4">
            <Link href="/ayuda#terminos">Términos y condiciones</Link>
            <Link href="/ayuda#privacidad">Privacidad</Link>
            <Link href="/ayuda#cookies">Cookies</Link>
          </span>
        </div>
      </div>
    </footer>
  );
}
