import type { Metadata, Viewport } from 'next';
import { Inter } from 'next/font/google';
import './globals.css';
import { Providers } from './providers';
import { getServerLocale, getT } from '@/lib/i18n/server';
import { serverGet } from '@/lib/server-api';

const inter = Inter({ subsets: ['latin'], variable: '--font-inter', display: 'swap' });

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return {
    title: { default: t('NEXOVAX · Marketplace multivendedor'), template: '%s · NEXOVAX' },
    description: t('Compra en tiendas de todo el mundo con un solo carrito. Miles de productos, múltiples vendedores y una plataforma segura.'),
  };
}

export const viewport: Viewport = { themeColor: '#0a6cf5' };

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const locale = await getServerLocale();
  const cfg = await serverGet<{ currency: string }>('/config/public', 60);
  return (
    <html lang={locale} className={inter.variable}>
      <body className="font-sans">
        <Providers locale={locale} currency={cfg?.currency ?? 'USD'}>{children}</Providers>
      </body>
    </html>
  );
}
