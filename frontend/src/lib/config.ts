'use client';
import { useQuery } from '@tanstack/react-query';
import { get } from './api';

export interface PublicConfig {
  name: string;
  currency: string;
  locale: string;
  defaultCountry: string;
  supportEmail: string;
  liveShippingRates: boolean;
  bankTransfer: boolean;
  sellerRegistration: boolean;
  /** Maintenance mode: only administrators can use the site. */
  maintenance?: boolean;
  stripePublishableKey?: string | null;
  /** Cloudflare Turnstile site key; null when the anti-bot check is off. */
  turnstileSiteKey?: string | null;
  social?: { network: string; url: string }[];
  /** GA4 measurement ID when Google Analytics is on; it loads only with analytics consent. */
  ga4MeasurementId?: string | null;
}

export function usePublicConfig() {
  return useQuery({ queryKey: ['public-config'], queryFn: () => get<PublicConfig>('/config/public'), staleTime: 60_000 }).data;
}
