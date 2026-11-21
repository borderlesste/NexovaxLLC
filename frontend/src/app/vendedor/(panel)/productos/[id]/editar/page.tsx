'use client';
import { use } from 'react';
import { ProductEditor } from '@/components/seller/product-editor';
import { DestinationsCard } from '@/components/seller/destinations-card';

export default function EditProductPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  return (
    <>
      <ProductEditor key={id} productId={id} />
      <div className="mt-5 max-w-3xl"><DestinationsCard productId={id} /></div>
    </>
  );
}
