import { t } from './i18n';

/** Seller legal entity types (international). Legacy DR codes map to readable labels too. */
export const ENTITY_TYPES = ['INDIVIDUAL', 'SOLE_PROPRIETOR', 'COMPANY', 'PARTNERSHIP', 'NONPROFIT', 'OTHER'] as const;

export function entityLabel(code?: string | null) {
  const m: Record<string, string> = {
    INDIVIDUAL: t('Persona física'),
    SOLE_PROPRIETOR: t('Empresa individual / autónomo'),
    COMPANY: t('Sociedad / empresa'),
    PARTNERSHIP: t('Sociedad de personas'),
    NONPROFIT: t('Organización sin fines de lucro'),
    OTHER: t('Otro'),
    PERSONA_FISICA: t('Persona física'),
    SRL: t('Sociedad / empresa'),
    SA: t('Sociedad / empresa'),
    EIRL: t('Empresa individual / autónomo'),
    OTRO: t('Otro'),
  };
  return code ? m[code] ?? code : '—';
}

/** Common name of the tax identifier per country (hint for sellers). */
export function taxIdHint(country?: string | null) {
  const m: Record<string, string> = {
    US: 'EIN / SSN', MX: 'RFC', ES: 'NIF / CIF', DO: 'RNC / Cédula', CO: 'NIT', AR: 'CUIT', CL: 'RUT', PE: 'RUC', GB: 'UTR / VAT', CA: 'BN', BR: 'CNPJ / CPF',
  };
  return country ? m[country] ?? t('Identificación fiscal') : t('Identificación fiscal');
}
