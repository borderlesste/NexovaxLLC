/**
 * Field-level validation shared by every DTO. Each decorator trims the value,
 * normalizes it where it makes sense (country codes, phones, SWIFT…) and
 * rejects data that doesn't belong to the field (text in a phone, digits in a
 * person's name, symbols in a postal code…) before it reaches the database.
 * Messages are Spanish keys translated by LocalizedExceptionFilter.
 */
import { applyDecorators } from '@nestjs/common';
import { Transform } from 'class-transformer';
import { IsEmail, IsNumber, Matches, Max, MaxLength, Min, MinLength, registerDecorator, ValidationOptions } from 'class-validator';

const trim = () => Transform(({ value }) => (typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : value));
const trimKeepLines = () => Transform(({ value }) => (typeof value === 'string' ? value.replace(/\r\n/g, '\n').trim() : value));
const upper = () => Transform(({ value }) => (typeof value === 'string' ? value.trim().toUpperCase() : value));
const emptyToUndefined = () => Transform(({ value }) => (typeof value === 'string' && value.trim() === '' ? undefined : value));

function rule(name: string, test: (v: unknown) => boolean, message: string, opts?: ValidationOptions): PropertyDecorator {
  return (target: object, propertyName: string | symbol) =>
    registerDecorator({
      name,
      target: target.constructor,
      propertyName: propertyName as string,
      options: { message, ...opts },
      validator: { validate: (v: unknown) => test(v) },
    });
}

// Unicode letters/marks (any language), no digits.
const NAME_RE = /^[\p{L}\p{M}][\p{L}\p{M}' .\-]*[\p{L}\p{M}.]$/u;
// Control characters (except tab/newline in multi-line text).
const CTRL_RE = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/;
const HTML_RE = /<\s*\/?\s*[a-z!][^>]*>/i;
const HAS_ALNUM = /[\p{L}\p{N}]/u;

/** Person name: letters, spaces, apostrophes, dots and hyphens. "Juan Pérez", "O'Neil", "Jean-Luc". */
export const IsPersonName = (min = 2, max = 120) =>
  applyDecorators(trim(), MinLength(min, { message: 'El nombre es demasiado corto.' }), MaxLength(max, { message: 'El nombre es demasiado largo.' }),
    Matches(NAME_RE, { message: 'El nombre solo puede contener letras, espacios, apóstrofos y guiones.' }));

/** Optional person name (empty → omitted). */
export const IsOptionalPersonName = (max = 80) =>
  applyDecorators(emptyToUndefined(), trim(), MaxLength(max, { message: 'El nombre es demasiado largo.' }),
    Matches(NAME_RE, { message: 'El nombre solo puede contener letras, espacios, apóstrofos y guiones.' }));

/** Account holder: a person or a business (letters required, digits allowed for company names). */
export const IsPersonNameOrBusiness = (min = 2, max = 120) =>
  applyDecorators(trim(), MinLength(min, { message: 'El nombre es demasiado corto.' }), MaxLength(max, { message: 'El nombre es demasiado largo.' }),
    Matches(/^(?=.*\p{L})[\p{L}\p{M}\p{N}][\p{L}\p{M}\p{N} &.,'()\-]*$/u, { message: 'El titular solo puede contener letras, números y los signos & . , \' - ( ).' }));

/** City/region/state: letters, spaces and . ' - ( ) , — no digits. */
export const IsPlaceName = (min = 2, max = 100) =>
  applyDecorators(trim(), MinLength(min, { message: 'El nombre del lugar es demasiado corto.' }), MaxLength(max, { message: 'El nombre del lugar es demasiado largo.' }),
    Matches(/^[\p{L}\p{M}][\p{L}\p{M}' .,()\-]*$/u, { message: 'La ciudad o región solo puede contener letras.' }));

/** Street address line: must contain letters or digits; common address punctuation only. */
export const IsAddressLine = (min = 3, max = 200) =>
  applyDecorators(trim(), MinLength(min, { message: 'La dirección es demasiado corta.' }), MaxLength(max, { message: 'La dirección es demasiado larga.' }),
    Matches(/^[\p{L}\p{M}\p{N}][\p{L}\p{M}\p{N} #.,'°ºª/()&\-]*$/u, { message: 'La dirección contiene caracteres no permitidos.' }));

/** International phone: digits with optional +, spaces, dots, dashes and parentheses; 7–15 digits (E.164). */
export const IsPhone = () =>
  applyDecorators(
    trim(),
    rule('isPhone', (v) => typeof v === 'string' && /^\+?[\d\s().\-]+$/.test(v) && (v.match(/\d/g)?.length ?? 0) >= 7 && (v.match(/\d/g)?.length ?? 0) <= 15 && !/\+.*\+/.test(v),
      'El teléfono solo puede contener números (7 a 15 dígitos) y los signos + ( ) -.'),
  );

export const IsEmailAddress = () =>
  applyDecorators(Transform(({ value }) => (typeof value === 'string' ? value.trim().toLowerCase() : value)), MaxLength(254, { message: 'Correo electrónico inválido.' }),
    IsEmail({}, { message: 'Correo electrónico inválido.' }));

/** ISO 3166-1 alpha-2 (normalized to upper case). */
export const IsCountryCode = () => applyDecorators(upper(), Matches(/^[A-Z]{2}$/, { message: 'Código de país inválido.' }));

/** ISO 4217 code. */
export const IsCurrencyCode = () => applyDecorators(upper(), Matches(/^[A-Z]{3}$/, { message: 'Código de moneda inválido.' }));

/** Postal code: letters, digits, spaces and hyphen, 3–10 chars, at least one digit (country rules checked by isPostalCodeFor). */
export const IsPostalCode = () =>
  applyDecorators(emptyToUndefined(), upper(), Matches(/^(?=.*\d)[A-Z0-9][A-Z0-9 \-]{1,8}[A-Z0-9]$/, { message: 'Código postal inválido.' }));

/** Short free text (titles, labels, subjects): no control chars, no HTML, must contain letters or digits. */
export const IsCleanText = (min: number, max: number) =>
  applyDecorators(
    trim(),
    MinLength(min, { message: `Debe tener al menos ${min} caracteres.` }),
    MaxLength(max, { message: `Admite máximo ${max} caracteres.` }),
    rule('isCleanText', (v) => typeof v === 'string' && !CTRL_RE.test(v) && !HTML_RE.test(v) && (v === '' || HAS_ALNUM.test(v)), 'El texto contiene caracteres o etiquetas no permitidos.'),
  );

/** Multi-line free text (descriptions, messages): keeps line breaks, rejects control chars and HTML tags. */
export const IsCleanMultiline = (min: number, max: number) =>
  applyDecorators(
    trimKeepLines(),
    MinLength(min, { message: `Debe tener al menos ${min} caracteres.` }),
    MaxLength(max, { message: `Admite máximo ${max} caracteres.` }),
    rule('isCleanMultiline', (v) => typeof v === 'string' && !CTRL_RE.test(v) && !HTML_RE.test(v) && (v === '' || HAS_ALNUM.test(v)), 'El texto contiene caracteres o etiquetas no permitidos.'),
  );

/** Business/brand/store/carrier name: letters required; digits and & . , ' - ( ) + allowed. */
export const IsBusinessName = (min = 2, max = 120) =>
  applyDecorators(trim(), MinLength(min, { message: 'El nombre es demasiado corto.' }), MaxLength(max, { message: 'El nombre es demasiado largo.' }),
    Matches(/^(?=.*\p{L})[\p{L}\p{M}\p{N}][\p{L}\p{M}\p{N} &.,'()+\-]*$/u, { message: 'El nombre solo puede contener letras, números y los signos & . , \' - ( ).' }));

/** Tax identification number (RNC, EIN, NIF, RFC…): letters/digits with . - /, at least 5 digits or letters+digits. */
export const IsTaxId = () =>
  applyDecorators(upper(), Matches(/^(?=(?:.*\d){3})[A-Z0-9][A-Z0-9.\-/ ]{2,28}[A-Z0-9]$/, { message: 'El identificador fiscal solo puede contener letras, números, puntos y guiones (mínimo 3 dígitos).' }));

/** Government ID / document number. */
export const IsDocumentId = () =>
  applyDecorators(emptyToUndefined(), upper(), Matches(/^(?=.*\d)[A-Z0-9][A-Z0-9\-]{3,19}$/, { message: 'Número de documento inválido.' }));

/** Bank account number or IBAN (spaces/dashes removed): 4–34 letters/digits, mostly digits. */
export const IsBankAccountNumber = () =>
  applyDecorators(
    Transform(({ value }) => (typeof value === 'string' ? value.replace(/[\s-]/g, '').toUpperCase() || undefined : value)),
    Matches(/^(?=(?:.*\d){4})[A-Z0-9]{4,34}$/, { message: 'Número de cuenta inválido: usa solo números (o el IBAN).' }),
  );

/** SWIFT/BIC (8 or 11) or US ABA routing number (9 digits). */
export const IsSwiftOrRouting = () =>
  applyDecorators(
    Transform(({ value }) => (typeof value === 'string' ? value.replace(/\s/g, '').toUpperCase() || undefined : value)),
    Matches(/^([A-Z]{6}[A-Z0-9]{2}([A-Z0-9]{3})?|\d{9})$/, { message: 'Código SWIFT/BIC (8 u 11 caracteres) o número de ruta (9 dígitos) inválido.' }),
  );

/** SKU: letters, digits, dot, underscore and hyphen. */
export const IsSku = () => applyDecorators(upper(), Matches(/^[A-Z0-9][A-Z0-9._\-]{0,63}$/, { message: 'El SKU solo puede contener letras, números, puntos, guiones y guiones bajos.' }));

/** URL slug. */
export const IsSlug = () =>
  applyDecorators(emptyToUndefined(), Transform(({ value }) => (typeof value === 'string' ? value.trim().toLowerCase() : value)), MaxLength(80),
    Matches(/^[a-z0-9]+(-[a-z0-9]+)*$/, { message: 'La URL amigable solo puede contener minúsculas, números y guiones.' }));

/** Carrier tracking number. */
export const IsTrackingNumber = () =>
  applyDecorators(emptyToUndefined(), upper(), Matches(/^[A-Z0-9][A-Z0-9\-]{3,39}$/, { message: 'El número de guía solo puede contener letras, números y guiones.' }));

/** Public order / payment reference such as NX-123456 or 123456. */
export const IsOrderReference = () =>
  applyDecorators(emptyToUndefined(), upper(), Matches(/^([A-Z]{2,4}-){0,2}\d{3,12}$/, { message: 'Número de pedido inválido (ej. NX-123456).' }));

/** Bank/payment reference provided by staff. */
export const IsPaymentReference = () =>
  applyDecorators(emptyToUndefined(), trim(), Matches(/^[A-Za-z0-9][A-Za-z0-9 \-/_.#]{2,79}$/, { message: 'La referencia solo puede contener letras, números y - / _ . #' }));

/** http(s) URL. */
export const IsWebUrl = (max = 300) =>
  applyDecorators(
    emptyToUndefined(),
    trim(),
    MaxLength(max, { message: 'El enlace es demasiado largo.' }),
    rule('isWebUrl', (v) => {
      if (typeof v !== 'string') return false;
      try {
        const u = new URL(v);
        return (u.protocol === 'https:' || u.protocol === 'http:') && u.hostname.includes('.') && !u.username && !u.password;
      } catch {
        return false;
      }
    }, 'Ingresa un enlace válido que empiece por https://'),
  );

/** IANA time zone, e.g. America/Santo_Domingo. */
const ZONES = new Set((Intl as any).supportedValuesOf?.('timeZone') ?? []);
export const IsTimeZone = () =>
  applyDecorators(emptyToUndefined(), rule('isTimeZone', (v) => typeof v === 'string' && (ZONES.size ? ZONES.has(v) || v === 'UTC' : /^[A-Za-z_]+(\/[A-Za-z_\-]+)+$/.test(v)), 'Zona horaria inválida.'));

/** Hex color for option swatches. */
export const IsHexColor = () => applyDecorators(emptyToUndefined(), Matches(/^#[0-9A-Fa-f]{6}$/, { message: 'El color debe tener el formato #RRGGBB.' }));

/** Money amount: positive, max 2 decimals, bounded. */
export const IsMoney = (min = 0.01, max = 10_000_000) =>
  applyDecorators(
    IsNumber({ maxDecimalPlaces: 2, allowNaN: false, allowInfinity: false }, { message: 'El monto debe ser un número con máximo 2 decimales.' }),
    Min(min, { message: `El monto mínimo es ${min}.` }),
    Max(max, { message: `El monto máximo es ${max}.` }),
  );

/** Physical measure (kg / cm): positive, bounded, max 4 decimals (exact g/oz/in conversions). */
export const IsMeasure = (max: number, label = 'La medida') =>
  applyDecorators(
    IsNumber({ maxDecimalPlaces: 4, allowNaN: false, allowInfinity: false }, { message: `${label} debe ser un número.` }),
    Min(0.0001, { message: `${label} debe ser mayor que 0.` }),
    Max(max, { message: `${label} supera el máximo permitido (${max}).` }),
  );

/** Strict number coercion: rejects "12abc", "", booleans and arrays (class-transformer's Number() would not). */
export const ToNumber = () =>
  Transform(({ value }) => {
    if (typeof value === 'number') return value;
    if (typeof value === 'string' && /^-?\d+(\.\d+)?$/.test(value.trim())) return Number(value.trim());
    return value === null || value === undefined ? value : NaN;
  });
