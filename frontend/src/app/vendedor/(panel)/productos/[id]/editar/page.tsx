'use client';
import { use } from 'react';
import { ProductEditor } from '@/components/seller/product-editor';

export default function EditProductPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  return <ProductEditor key={id} productId={id} />;
}
