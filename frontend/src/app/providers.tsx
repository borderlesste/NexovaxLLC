'use client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Toaster } from 'sonner';
import { useState } from 'react';
import { AuthProvider } from '@/lib/auth';

export function Providers({ children }: { children: React.ReactNode }) {
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
