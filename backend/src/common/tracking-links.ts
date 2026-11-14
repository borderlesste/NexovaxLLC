/**
 * Tracking links. For known carriers the link is always derived from the
 * tracking number (never taken from the seller). Seller-supplied links for
 * other carriers must be plain https URLs and are flagged as external so the
 * UI and e-mails show the destination host before the customer follows them.
 */
const KNOWN: Record<string, (n: string) => string> = {
  USPS: (n) => `https://tools.usps.com/go/TrackConfirmAction?tLabels=${n}`,
  UPS: (n) => `https://www.ups.com/track?tracknum=${n}`,
  FEDEX: (n) => `https://www.fedex.com/fedextrack/?trknbr=${n}`,
  DHL_EXPRESS: (n) => `https://www.dhl.com/global-en/home/tracking/tracking-express.html?tracking-id=${n}`,
  CANADA_POST: (n) => `https://www.canadapost-postescanada.ca/track-reperage/en#/search?searchFor=${n}`,
  ROYAL_MAIL: (n) => `https://www.royalmail.com/track-your-item#/tracking-results/${n}`,
  CORREOS: (n) => `https://www.correos.es/es/es/herramientas/localizador/envios/detalle?tracking-number=${n}`,
  DEUTSCHE_POST: (n) => `https://www.deutschepost.de/de/s/sendungsverfolgung.html?piececode=${n}`,
  ESTAFETA: (n) => `https://www.estafeta.com/rastreo?guias=${n}`,
};

export const isKnownCarrier = (code?: string | null) => !!code && code in KNOWN;

export function carrierTrackingUrl(carrierCode: string | null | undefined, trackingNumber: string | null | undefined): string | null {
  const n = trackingNumber?.trim();
  if (!carrierCode || !n || !(carrierCode in KNOWN)) return null;
  return KNOWN[carrierCode](encodeURIComponent(n));
}

/** Returns a normalized https URL or null when the value isn't an acceptable public link. */
export function safeExternalUrl(raw: string | null | undefined): string | null {
  const v = raw?.trim();
  if (!v || v.length > 300) return null;
  try {
    const u = new URL(v);
    if (u.protocol !== 'https:' || u.username || u.password || !u.hostname.includes('.')) return null;
    if (/^[\d.]+$/.test(u.hostname) || u.hostname.startsWith('[')) return null; // no bare IPs
    return u.toString();
  } catch {
    return null;
  }
}

/** Link to show for a tracking row, with whether it points outside known carriers. */
export function trackingLink(t: { carrier_code?: string | null; tracking_number?: string | null; tracking_url?: string | null; provider_tracking_id?: string | null }) {
  const derived = carrierTrackingUrl(t.carrier_code, t.tracking_number);
  if (derived) return { url: derived, external: false, host: new URL(derived).hostname };
  const url = safeExternalUrl(t.tracking_url);
  if (!url) return { url: null, external: false, host: null };
  // Provider (Shippo) links come from the carrier integration, not from the seller.
  return { url, external: !t.provider_tracking_id, host: new URL(url).hostname };
}
