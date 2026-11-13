'use client';
import { useQuery } from '@tanstack/react-query';
import { get } from './api';

export interface PublicConfig {
  name: string;
  currency: string;
  locale: string;
  locales: string[];
  defaultCountry: string;
  supportEmail: string;
  liveShippingRates: boolean;
  bankTransfer: boolean;
  sellerRegistration: boolean;
}

export function usePublicConfig() {
  return useQuery({ queryKey: ['public-config'], queryFn: () => get<PublicConfig>('/config/public'), staleTime: 60_000 }).data;
}
