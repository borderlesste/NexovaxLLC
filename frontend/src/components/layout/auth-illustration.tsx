import { ShoppingBag, ShoppingCart, Store } from 'lucide-react';

export function StorefrontIllustration() {
  return (
    <div className="relative mx-auto h-56 w-full max-w-sm">
      <div className="absolute inset-x-6 bottom-6 top-8 rounded-2xl border-[6px] border-brand-300 bg-white shadow-xl">
        <div className="flex h-8 overflow-hidden rounded-t-lg">
          {Array.from({ length: 6 }).map((_, i) => <div key={i} className={i % 2 ? 'flex-1 bg-white' : 'flex-1 bg-brand-400'} />)}
        </div>
        <div className="flex gap-3 p-4">
          <div className="grid size-16 place-items-center rounded-xl bg-brand-50 text-brand-500"><ShoppingCart className="size-8" /></div>
          <div className="flex-1 space-y-2 pt-1">
            <div className="h-2.5 w-full rounded bg-brand-100" />
            <div className="h-2.5 w-3/4 rounded bg-brand-100" />
            <div className="h-2.5 w-1/2 rounded bg-brand-100" />
          </div>
        </div>
      </div>
      <div className="absolute bottom-2 left-0 right-0 h-4 rounded-full bg-brand-200/70" />
      <div className="absolute -top-1 right-6 grid size-16 place-items-center rounded-2xl bg-white text-brand-600 shadow-lg"><Store className="size-8" /></div>
      <div className="absolute bottom-0 right-2 grid size-20 place-items-center rounded-2xl bg-brand-400 text-white shadow-lg"><ShoppingBag className="size-10" /></div>
    </div>
  );
}
