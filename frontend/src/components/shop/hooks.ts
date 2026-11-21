'use client';
import { t } from '@/lib/i18n';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { errorMessage, post } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { guestCart } from '@/lib/guest-cart';

export function useRequireAuth() {
  const { session } = useAuth();
  const router = useRouter();
  return (next?: string) => {
    if (session) return true;
    toast.info(t('Inicia sesión para continuar.'));
    router.push(`/auth/iniciar-sesion?next=${encodeURIComponent(next ?? window.location.pathname + window.location.search)}`);
    return false;
  };
}

export function useAddToCart() {
  const qc = useQueryClient();
  const { session } = useAuth();
  const m = useMutation({
    mutationFn: (v: { variantId: string; quantity: number }) => post('/cart/items', v),
    onSuccess: (cart) => {
      qc.setQueryData(['cart'], cart);
      qc.invalidateQueries({ queryKey: ['me'] });
      toast.success(t('Producto agregado al carrito.'));
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  return {
    ...m,
    add: (variantId: string, quantity = 1) => {
      // Without an account the product goes to the browser's guest cart; paying asks to sign in.
      if (!session) {
        guestCart.add(variantId, quantity);
        qc.invalidateQueries({ queryKey: ['guest-cart'] });
        toast.success(t('Producto agregado al carrito.'));
        return Promise.resolve({ guest: true });
      }
      return m.mutateAsync({ variantId, quantity }).catch(() => null);
    },
  };
}

export function useToggleFavorite() {
  const qc = useQueryClient();
  const requireAuth = useRequireAuth();
  const m = useMutation({
    mutationFn: (productId: string) => post<{ favorite: boolean }>(`/me/favorites/${productId}`),
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ['me'] });
      qc.invalidateQueries({ queryKey: ['favorites'] });
      toast.success(r.favorite ? 'Agregado a favoritos.' : t('Eliminado de favoritos.'));
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  return { ...m, toggle: (id: string) => requireAuth() && m.mutate(id) };
}
