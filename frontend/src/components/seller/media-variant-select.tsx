'use client';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { put, errorMessage } from '@/lib/api';
import { t } from '@/lib/i18n';

type SavedVariant = { id: string; sku: string; optionValues: Record<string, string> };
type SellerProduct = { media: { id: string; variantId: string | null }[]; slug: string };

export function MediaVariantSelect({ productId, mediaId, variantId, variants }: {
  productId: string;
  mediaId: string;
  variantId: string | null;
  variants: SavedVariant[];
}) {
  const qc = useQueryClient();
  const update = useMutation({
    mutationFn: (next: string) => put<SellerProduct>(`/seller/products/${productId}/media/${mediaId}/variant`, { variantId: next || null }),
    onSuccess: (saved) => {
      const photo = saved.media.find((m) => m.id === mediaId);
      if (photo) {
        qc.setQueryData<SellerProduct>(['seller-product', productId], (current) =>
          current ? { ...current, media: current.media.map((m) => m.id === mediaId ? { ...m, variantId: photo.variantId } : m) } : saved);
      }
      qc.invalidateQueries({ queryKey: ['product', saved.slug] });
    },
    onError: (error) => toast.error(errorMessage(error)),
  });
  if (!variantId && !variants.some((v) => Object.keys(v.optionValues).length)) return null;
  return (
    <label className="block bg-white p-1.5 text-xs">
      <span className="font-semibold">{t('Variante de la foto')}</span>
      <select value={update.isPending ? update.variables : variantId ?? ''} disabled={update.isPending} onChange={(e) => update.mutate(e.target.value)}
        className="mt-1 block w-full min-w-0 rounded border border-line bg-white py-1 text-ink">
        <option value="">{t('Todas las variantes')}</option>
        {variants.map((v) => <option key={v.id} value={v.id}>{[...Object.values(v.optionValues), v.sku].filter(Boolean).join(' · ')}</option>)}
      </select>
    </label>
  );
}
