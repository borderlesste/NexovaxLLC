import { redirect } from 'next/navigation';

/** Messages live in "Mi cuenta"; old links (/mensajes?c=…) keep working. */
export default async function MessagesRedirect({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const c = typeof sp.c === 'string' && /^[0-9a-f-]{36}$/i.test(sp.c) ? `?c=${sp.c}` : '';
  redirect(`/cuenta/mensajes${c}`);
}
