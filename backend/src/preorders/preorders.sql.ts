export const openPreorderSql = (offer: string) =>
  `${offer}.status = 'OPEN' and ${offer}.arrival_at > statement_timestamp()`;

export const variantHasPhysicalStockSql = (variant: string) => `exists (
  select 1 from public.inventory_items i
   where i.variant_id = ${variant}.id and i.status = 'ACTIVE' and i.on_hand > 0
)`;

/** A published product can remain discoverable while its variants await inventory. */
export const productHasPreorderSql = (product: string) => `exists (
  select 1 from public.product_variants pv
  join public.nx_preorder_offers po on po.variant_id = pv.id
   where pv.product_id = ${product}.id and pv.status = 'ACTIVE'
     and ${openPreorderSql('po')} and not ${variantHasPhysicalStockSql('pv')}
)`;
