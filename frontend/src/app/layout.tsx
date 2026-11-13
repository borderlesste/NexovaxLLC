import type { Metadata, Viewport } from 'next';
import { Inter } from 'next/font/google';
import './globals.css';
import { Providers } from './providers';

const inter = Inter({ subsets: ['latin'], variable: '--font-inter', display: 'swap' });

export const metadata: Metadata = {
  title: { default: 'RD Marketplace Multivendedor', template: '%s · RD Marketplace' },
  description: 'Compra en tus tiendas favoritas y apoya a vendedores dominicanos. Miles de productos, múltiples tiendas y una sola plataforma segura.',
  icons: { icon: '/favicon.svg' },
};

export const viewport: Viewport = { themeColor: '#5b2be0' };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es-DO" className={inter.variable}>
      <body className="font-sans">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
