/**
 * Product attribute values driven by attribute_definitions.validation_rules:
 *   { input: 'select' | 'combobox' | 'text', options: [{ value, label, labelEn }] }
 * - select:   closed list, the stored value is the option code.
 * - combobox: an option code, or free text typed by the seller (later suggested to others).
 * - text:     free text.
 * NUMBER and BOOLEAN definitions are validated by type.
 */
export interface AttributeOption {
  value: string;
  label: string;
  labelEn?: string;
}
export type AttributeInput = 'select' | 'combobox' | 'text';

export interface AttributeDefinitionRow {
  id: string;
  name: string;
  data_type: string;
  validation_rules?: { input?: AttributeInput; options?: AttributeOption[] } | null;
}

export class AttributeValueError extends Error {}

const fold = (s: string) => s.normalize('NFD').replace(/\p{M}/gu, '').trim().toLowerCase();

export const attributeInput = (d: AttributeDefinitionRow): AttributeInput | 'number' | 'boolean' =>
  d.data_type === 'NUMBER' ? 'number' : d.data_type === 'BOOLEAN' ? 'boolean' : (d.validation_rules?.input ?? 'text');

export const attributeOptions = (d: Pick<AttributeDefinitionRow, 'validation_rules'>): AttributeOption[] =>
  Array.isArray(d.validation_rules?.options) ? d.validation_rules!.options! : [];

/** Finds an option by code or by its Spanish/English label (accent- and case-insensitive). */
export function matchOption(options: AttributeOption[], raw: string): AttributeOption | undefined {
  const f = fold(raw);
  return options.find((o) => o.value === raw || fold(o.value) === f || fold(o.label) === f || (o.labelEn && fold(o.labelEn) === f));
}

/** Returns the DB columns [value_text, value_number, value_boolean] or throws AttributeValueError. */
export function normalizeAttributeValue(d: AttributeDefinitionRow, rawValue: unknown): [string | null, number | null, boolean | null] {
  const raw = String(rawValue ?? '').trim();
  const kind = attributeInput(d);
  if (kind === 'number') {
    const n = raw.replace(',', '.');
    if (!/^-?\d{1,12}(\.\d{1,4})?$/.test(n)) throw new AttributeValueError(`${d.name}: debe ser un número.`);
    return [null, Number(n), null];
  }
  if (kind === 'boolean') {
    const b = fold(raw);
    if (['true', 'si', '1', 'yes'].includes(b)) return [null, null, true];
    if (['false', 'no', '0'].includes(b)) return [null, null, false];
    throw new AttributeValueError(`${d.name}: elige Sí o No.`);
  }
  const options = attributeOptions(d);
  const hit = options.length ? matchOption(options, raw) : undefined;
  if (kind === 'select') {
    if (!hit) throw new AttributeValueError(`${d.name}: elige una opción de la lista.`);
    return [hit.value, null, null];
  }
  if (hit) return [hit.value, null, null];
  if (raw.length > 200 || !/[\p{L}\p{N}]/u.test(raw) || /[<>\u0000-\u001f]/.test(raw)) throw new AttributeValueError(`${d.name}: el valor no es válido.`);
  return [raw.replace(/\s+/g, ' '), null, null];
}

/** Human label of a stored text value (option code → label; free text as typed). */
export function attributeLabel(rules: AttributeDefinitionRow['validation_rules'], value: string | null, locale: 'es' | 'en' = 'es') {
  if (value == null) return null;
  const o = attributeOptions({ validation_rules: rules }).find((x) => x.value === value);
  if (!o) return value;
  return locale === 'en' ? o.labelEn || o.label : o.label;
}
