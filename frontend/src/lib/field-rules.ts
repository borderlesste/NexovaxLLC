/**
 * Input rules for form fields. They filter what the user types or pastes so a
 * field only receives data of its kind (no letters in a phone, no digits in a
 * name…), choose the right mobile keyboard and cap the length. The backend
 * validates the same rules again; these are a first line of defense and UX.
 */
export type FieldRule =
  | 'phone' | 'personName' | 'placeName' | 'postalCode' | 'businessName' | 'email'
  | 'money' | 'integer' | 'measure' | 'percent' | 'sku' | 'slug' | 'trackingNumber'
  | 'decimal' | 'bankAccount' | 'swift' | 'taxId' | 'documentId' | 'countryCode' | 'reference' | 'cardNumber' | 'cvc';

type RuleDef = {
  filter: (v: string) => string;
  /** Cash-register entry: digits fill from the right with a fixed 2-decimal point (1 → 0.01, 1999 → 19.99). */
  shift?: boolean;
  /** Normalizes the value when leaving the field. */
  format?: (v: string) => string; inputMode?: React.HTMLAttributes<HTMLInputElement>['inputMode']; type?: string; maxLength?: number; autoComplete?: string; autoCapitalize?: string };

/** Keep at most `decimals` decimals and a single separator; comma is accepted as decimal separator. */
const decimal = (decimals: number, maxInt = 9) => (v: string) => {
  let s = v.replace(',', '.').replace(/[^\d.]/g, '');
  const i = s.indexOf('.');
  if (i >= 0) s = s.slice(0, i + 1) + s.slice(i + 1).replace(/\./g, '').slice(0, decimals);
  const [int, dec] = s.split('.');
  return (int ?? '').slice(0, maxInt) + (dec !== undefined && decimals > 0 ? '.' + dec : '');
};

/** "1.50" → "1.5", "30." → "30", "007" → "7"; empty stays empty. */
const trimNumber = (v: string) => (v === '' || isNaN(Number(v)) ? v : String(Number(v)));

/** Cash-register value from whatever is in the field: only digits count, the last two are cents. */
export const shiftMoney = (v: string) => {
  const digits = v.replace(/\D/g, '').replace(/^0+/, '').slice(0, 10);
  return digits ? (Number(digits) / 100).toFixed(2) : '';
};

export const RULES: Record<FieldRule, RuleDef> = {
  // digits, + only at the start, spaces, ( ) - .
  phone: { filter: (v) => v.replace(/[^\d+\s().-]/g, '').replace(/(?!^)\+/g, '').slice(0, 22), inputMode: 'tel', type: 'tel', maxLength: 22, autoComplete: 'tel' },
  personName: { filter: (v) => v.replace(/[^\p{L}\p{M}' .-]/gu, '').replace(/\s{2,}/g, ' ').slice(0, 120), maxLength: 120, autoCapitalize: 'words' },
  placeName: { filter: (v) => v.replace(/[^\p{L}\p{M}' .,()-]/gu, '').replace(/\s{2,}/g, ' ').slice(0, 100), maxLength: 100, autoCapitalize: 'words' },
  businessName: { filter: (v) => v.replace(/[^\p{L}\p{M}\p{N} &.,'()+-]/gu, '').replace(/\s{2,}/g, ' ').slice(0, 160), maxLength: 160 },
  postalCode: { filter: (v) => v.toUpperCase().replace(/[^A-Z0-9 -]/g, '').slice(0, 10), maxLength: 10, autoComplete: 'postal-code', autoCapitalize: 'characters' },
  email: { filter: (v) => v.replace(/\s/g, '').slice(0, 254), type: 'email', inputMode: 'email', maxLength: 254, autoComplete: 'email' },
  money: { filter: decimal(2, 8), inputMode: 'numeric', shift: true, format: (v) => (v && Number(v) > 0 ? Number(v).toFixed(2) : v ? '0.00' : '') },
  integer: { filter: (v) => v.replace(/\D/g, '').slice(0, 7), inputMode: 'numeric' },
  measure: { filter: decimal(3, 4), inputMode: 'decimal', format: trimNumber },
  percent: { filter: decimal(2, 3), inputMode: 'decimal', format: trimNumber },
  decimal: { filter: decimal(4, 12), inputMode: 'decimal', format: trimNumber },
  sku: { filter: (v) => v.toUpperCase().replace(/[^A-Z0-9._-]/g, '').slice(0, 64), maxLength: 64, autoCapitalize: 'characters' },
  slug: { filter: (v) => v.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '').replace(/-{2,}/g, '-').slice(0, 80), maxLength: 80 },
  trackingNumber: { filter: (v) => v.toUpperCase().replace(/[^A-Z0-9-]/g, '').slice(0, 40), maxLength: 40, autoCapitalize: 'characters' },
  bankAccount: { filter: (v) => v.toUpperCase().replace(/[^A-Z0-9 -]/g, '').slice(0, 42), maxLength: 42, inputMode: 'text', autoCapitalize: 'characters' },
  swift: { filter: (v) => v.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 11), maxLength: 11, autoCapitalize: 'characters' },
  taxId: { filter: (v) => v.toUpperCase().replace(/[^A-Z0-9./ -]/g, '').slice(0, 30), maxLength: 30, autoCapitalize: 'characters' },
  documentId: { filter: (v) => v.toUpperCase().replace(/[^A-Z0-9-]/g, '').slice(0, 20), maxLength: 20, autoCapitalize: 'characters' },
  countryCode: { filter: (v) => v.toUpperCase().replace(/[^A-Z]/g, '').slice(0, 2), maxLength: 2, autoCapitalize: 'characters' },
  reference: { filter: (v) => v.replace(/[^A-Za-z0-9 \-/_.#]/g, '').slice(0, 80), maxLength: 80 },
  cardNumber: { filter: (v) => v.replace(/\D/g, '').slice(0, 19).replace(/(\d{4})(?=\d)/g, '$1 '), inputMode: 'numeric', maxLength: 23, autoComplete: 'cc-number' },
  cvc: { filter: (v) => v.replace(/\D/g, '').slice(0, 4), inputMode: 'numeric', maxLength: 4, autoComplete: 'cc-csc' },
};

/** Same checks the API applies; used to show the error before submitting. */
export const CHECKS: Partial<Record<FieldRule, (v: string) => boolean>> = {
  phone: (v) => { const d = v.replace(/\D/g, '').length; return d >= 7 && d <= 15; },
  personName: (v) => /^[\p{L}\p{M}][\p{L}\p{M}' .-]*[\p{L}\p{M}.]$/u.test(v.trim()),
  placeName: (v) => /^[\p{L}\p{M}][\p{L}\p{M}' .,()-]*$/u.test(v.trim()) && v.trim().length >= 2,
  businessName: (v) => /\p{L}/u.test(v) && v.trim().length >= 2,
  postalCode: (v) => /^(?=.*\d)[A-Z0-9][A-Z0-9 -]{1,8}[A-Z0-9]$/.test(v.trim()),
  email: (v) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v),
  money: (v) => /^\d+(\.\d{1,2})?$/.test(v) && Number(v) > 0,
  integer: (v) => /^\d+$/.test(v),
  measure: (v) => /^\d+(\.\d{1,3})?$/.test(v) && Number(v) > 0,
  sku: (v) => /^[A-Z0-9][A-Z0-9._-]*$/.test(v),
  swift: (v) => /^([A-Z]{6}[A-Z0-9]{2}([A-Z0-9]{3})?|\d{9})$/.test(v),
  bankAccount: (v) => /^(?=(?:.*\d){4})[A-Z0-9]{4,34}$/.test(v.replace(/[\s-]/g, '')),
  taxId: (v) => (v.match(/\d/g)?.length ?? 0) >= 3,
};

export const RULE_HINT: Partial<Record<FieldRule, string>> = {
  phone: 'Solo números (7 a 15 dígitos) y los signos + ( ) -.',
  personName: 'Solo letras, espacios, apóstrofos y guiones.',
  placeName: 'Solo letras.',
  postalCode: 'Letras y números (ej. 10148, 33131).',
  email: 'Correo electrónico inválido.',
  money: 'Monto numérico mayor que 0, máximo 2 decimales.',
  measure: 'Número mayor que 0.',
  swift: 'Código SWIFT/BIC (8 u 11 caracteres) o número de ruta (9 dígitos).',
  bankAccount: 'Solo números (o el IBAN).',
  taxId: 'Letras, números, puntos y guiones (mínimo 3 dígitos).',
};
