import { Minor, toMinor } from '../common/money';
import type { DbService, Queryable } from '../db/db.service';
import type { ShippingOption } from './shipping.service';

/** Stored service token for a free delivery arranged and paid by the store. */
export const SELLER_FREE_SHIPPING = 'NX_SELLER_FREE_SHIPPING';

interface FreeShippingPolicy {
  seller_id: string;
  country_codes: string[];
  minimum_subtotal: string | null;
  currency_code: string;
}

export async function freeShippingPolicies(db: DbService, sellerIds: string[], client?: Queryable) {
  const rows = sellerIds.length ? await db.many<FreeShippingPolicy>(
    `select seller_id, country_codes, minimum_subtotal::text, currency_code
       from public.nx_seller_free_shipping where seller_id = any($1::uuid[]) and enabled
       order by seller_id${client ? ' for share' : ''}`,
    [sellerIds], client,
  ) : [];
  return new Map(rows.map((row) => [row.seller_id, row]));
}

export function qualifiesForFreeShipping(policy: FreeShippingPolicy | undefined, country: string, currency: string, subtotal: Minor) {
  return !!policy && policy.currency_code === currency && policy.country_codes.includes(country)
    && subtotal >= toMinor(policy.minimum_subtotal);
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
