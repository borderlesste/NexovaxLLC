'use client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Toaster } from 'sonner';
import { useState } from 'react';
import { AuthProvider } from '@/lib/auth';
import { configureI18n, type Locale } from '@/lib/i18n';

export function Providers({ children, locale, currency }: { children: React.ReactNode; locale: Locale; currency: string }) {
  configureI18n(locale, currency);
  const [qc] = useState(
    () =>
      new QueryClient({
        defaultOptions: { queries: { refetchOnWindowFocus: false, retry: (n, e: any) => n < 1 && ![401, 403, 404].includes(e?.status) } },
      }),
  );
  return (
    <QueryClientProvider client={qc}>
      <AuthProvider>{children}</AuthProvider>
      <Toaster position="top-right" richColors closeButton />
    </QueryClientProvider>
  );
}
