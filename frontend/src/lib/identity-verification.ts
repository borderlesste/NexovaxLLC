import { t } from './i18n';

/** «Identidad verificada» requests: labels shared by the seller and admin screens (API codes in backend/src/seller/identity-verification.service.ts). */
export const ID_DOC_TYPES = ['GOVERNMENT_ID', 'BUSINESS_REGISTRY'] as const;
export const ID_REJECTION_REASONS = ['ILLEGIBLE', 'EXPIRED', 'MISMATCH', 'INCOMPLETE', 'OTHER'] as const;

export const idDocTypeLabel = (c?: string | null) =>
  c === 'GOVERNMENT_ID' ? t('Documento de identidad oficial del propietario') : c === 'BUSINESS_REGISTRY' ? t('Registro oficial de la empresa') : '—';

export const idDocTypeHint = (c: string) =>
  c === 'GOVERNMENT_ID'
    ? t('Cédula, pasaporte o licencia de conducir vigente, a nombre del propietario de la tienda. Incluye el frente y el reverso.')
    : t('Certificado o extracto del registro oficial de empresas donde figuren la razón social y la identificación fiscal de tu tienda.');

export const idRejectionLabel = (c?: string | null) =>
  ({
    ILLEGIBLE: t('El documento no se puede leer bien.'),
    EXPIRED: t('El documento está vencido.'),
    MISMATCH: t('Los datos del documento no coinciden con los de la tienda.'),
    INCOMPLETE: t('Falta una parte del documento (por ejemplo, el reverso).'),
    OTHER: t('Otro motivo.'),
  })[c ?? ''] ?? '—';

export const idRequestStatusLabel = (s?: string | null) =>
  ({ PENDING: t('En revisión'), APPROVED: t('Aprobada'), REJECTED: t('Rechazada'), CANCELLED: t('Cancelada') })[s ?? ''] ?? '—';

export const idLogLabel = (a: string) =>
  ({ SUBMIT: t('Solicitud enviada'), CANCEL: t('Cancelada por la tienda'), VIEW_FILE: t('Archivo abierto'), APPROVE: t('Aprobada'), REJECT: t('Rechazada'), PURGE_FILES: t('Archivos borrados') })[a] ?? a;
