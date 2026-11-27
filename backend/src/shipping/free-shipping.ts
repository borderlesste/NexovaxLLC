import { Minor, toMinor } from '../common/money';
import type { DbService, Queryable } from '../db/db.service';
import type { ShippingOption } from './shipping.service';

/** Stored service token for a free delivery arranged and paid by the store. */
export const SELLER_FREE_SHIPPING = 'NX_SELLER_FREE_SHIPPING';

export interface FreeShippingPolicy {
  product_id: string;
  country_codes: string[];
  minimum_subtotal: string | null;
  currency_code: string;
}

/** Enabled free-shipping settings of the given products, keyed by product id. */
export async function freeShippingPolicies(db: DbService, productIds: string[], client?: Queryable) {
  const ids = [...new Set(productIds)];
  const rows = ids.length ? await db.many<FreeShippingPolicy>(
    `select product_id, country_codes, minimum_subtotal::text, currency_code
       from public.nx_product_free_shipping where product_id = any($1::uuid[]) and enabled
       order by product_id${client ? ' for share' : ''}`,
    [ids], client,
  ) : [];
  return new Map(rows.map((row) => [row.product_id, row]));
}

export interface FreeShippingLine { productId: string; requiresShipping?: boolean | null }

/**
 * A store's shipment is free only when every product in it that needs shipping offers free shipping
 * to the country, and the store subtotal reaches the minimum of each of those products.
 * One paid product in the same shipment means the buyer pays the regular rate.
 */
export function qualifiesForFreeShipping(
  policies: ReadonlyMap<string, FreeShippingPolicy>, lines: FreeShippingLine[], country: string, currency: string, subtotal: Minor,
) {
  const shipped = lines.filter((line) => line.requiresShipping !== false);
  return shipped.length > 0 && shipped.every((line) => {
    const policy = policies.get(line.productId);
    return !!policy && policy.currency_code === currency && policy.country_codes.includes(country)
      && subtotal >= toMinor(policy.minimum_subtotal);
  });
}

export function sellerFreeShippingOption(currency: string): ShippingOption {
  return {
    code: SELLER_FREE_SHIPPING,
    provider: 'MARKETPLACE',
    carrierCode: 'SELLER_ARRANGED',
    carrierName: 'NEXOVAX',
    serviceToken: SELLER_FREE_SHIPPING,
    serviceName: 'Envío gratis',
    description: 'Envío gestionado por la tienda.',
    amount: '0.00',
    currency,
    estimatedDays: null,
    providerRateId: null,
    providerShipmentId: null,
    providerAmount: null,
    providerCurrency: null,
    attributes: [],
    carrierLogo: null,
  };
}
