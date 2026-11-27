/**
 * Which sellers' tax identifiers may be printed on a buyer's receipt.
 *
 * A seller's tax ID is collected for KYB and stored encrypted. For an individual, a sole proprietor or an
 * "other" entity it is often a personal identity number (SSN, Cédula, CPF…), so it is never disclosed.
 * Only business entity types can be enabled (Admin → Configuración → General → Recibos), and the
 * identifier is only decrypted for the buyer's own receipt (GET /orders/:id/receipt), never in the
 * shared order detail that sellers and staff also read.
 */
export const RECEIPT_TAX_ID_ELIGIBLE_TYPES = ['COMPANY', 'PARTNERSHIP', 'NONPROFIT'] as const;
export type ReceiptTaxIdEntityType = (typeof RECEIPT_TAX_ID_ELIGIBLE_TYPES)[number];

export interface ReceiptTaxIdSettings {
  /** Entity types whose tax ID is printed on receipts; a subset of RECEIPT_TAX_ID_ELIGIBLE_TYPES. */
  entityTypes: ReceiptTaxIdEntityType[];
}

export const DEFAULT_RECEIPT_TAX_ID: ReceiptTaxIdSettings = { entityTypes: [...RECEIPT_TAX_ID_ELIGIBLE_TYPES] };

/** Legacy Dominican codes that are companies (EIRL and PERSONA_FISICA are individuals, OTRO is ambiguous). */
const LEGACY_COMPANY_CODES = new Set(['SRL', 'SA']);

function eligibleType(code: string | null | undefined): ReceiptTaxIdEntityType | null {
  if (!code) return null;
  if (LEGACY_COMPANY_CODES.has(code)) return 'COMPANY';
  return (RECEIPT_TAX_ID_ELIGIBLE_TYPES as readonly string[]).includes(code) ? (code as ReceiptTaxIdEntityType) : null;
}

/** Keeps only eligible, distinct entity types; anything else (INDIVIDUAL, SOLE_PROPRIETOR, OTHER…) is dropped. */
export function normalizeReceiptTaxId(v: unknown): ReceiptTaxIdSettings {
  const list = Array.isArray((v as any)?.entityTypes) ? (v as any).entityTypes : DEFAULT_RECEIPT_TAX_ID.entityTypes;
  const out = new Set<ReceiptTaxIdEntityType>();
  for (const c of list) {
    if (typeof c === 'string' && (RECEIPT_TAX_ID_ELIGIBLE_TYPES as readonly string[]).includes(c)) out.add(c as ReceiptTaxIdEntityType);
  }
  return { entityTypes: RECEIPT_TAX_ID_ELIGIBLE_TYPES.filter((c) => out.has(c)) };
}

/** True when this seller's tax ID may appear on the receipt. */
export function receiptTaxIdAllowed(entityTypeCode: string | null | undefined, settings: ReceiptTaxIdSettings): boolean {
  const type = eligibleType(entityTypeCode);
  return !!type && normalizeReceiptTaxId(settings).entityTypes.includes(type);
}
