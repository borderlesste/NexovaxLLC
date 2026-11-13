export type Tone = 'green' | 'amber' | 'red' | 'blue' | 'violet' | 'gray';

const MAP: Record<string, [string, Tone]> = {
  // orders
  PENDING_PAYMENT: ['Pago pendiente', 'amber'],
  PAID: ['Pagado', 'green'],
  PREPARING: ['En preparación', 'violet'],
  SHIPPED: ['Enviado', 'blue'],
  DELIVERED: ['Entregado', 'green'],
  CANCELLED: ['Cancelado', 'red'],
  PROCESSING: ['En proceso', 'violet'],
  COMPLETED: ['Completado', 'green'],
  UNFULFILLED: ['Por preparar', 'amber'],
  FULFILLED: ['Preparado', 'violet'],
  PARTIALLY_SHIPPED: ['Envío parcial', 'blue'],
  PARTIALLY_DELIVERED: ['Entrega parcial', 'blue'],
  // products
  ACTIVE: ['Publicado', 'green'],
  DRAFT: ['Borrador', 'amber'],
  PENDING_REVIEW: ['En revisión', 'violet'],
  REJECTED: ['Rechazado', 'red'],
  PAUSED: ['Pausado', 'gray'],
  OUT_OF_STOCK: ['Agotado', 'red'],
  SUSPENDED: ['Suspendido', 'red'],
  ARCHIVED: ['Archivado', 'gray'],
  // sellers
  PENDING_VERIFICATION: ['Pendiente', 'amber'],
  VERIFIED: ['Verificado', 'green'],
  // payouts
  REQUESTED: ['Solicitado', 'amber'],
  APPROVAL_REQUIRED: ['Pendiente', 'amber'],
  APPROVED: ['Aprobado', 'green'],
  FAILED: ['Fallido', 'red'],
  REVERSED: ['Revertido', 'red'],
  REQUIRES_ACTION: ['Esperando transferencia', 'amber'],
  // support
  OPEN: ['Pendiente', 'amber'],
  IN_PROGRESS: ['En proceso', 'blue'],
  PENDING_CUSTOMER: ['Esperando usuario', 'violet'],
  PENDING_INTERNAL: ['Revisión interna', 'violet'],
  RESOLVED: ['Resuelto', 'green'],
  CLOSED: ['Cerrado', 'gray'],
  // tracking
  IN_TRANSIT: ['En tránsito', 'blue'],
  OUT_FOR_DELIVERY: ['En ruta', 'blue'],
  EXCEPTION: ['Incidencia', 'red'],
  // inventory
  OK: ['En stock', 'green'],
  LOW: ['Stock bajo', 'amber'],
  OUT: ['Sin stock', 'red'],
  // payout accounts
  PENDING: ['Pendiente', 'amber'],
  INACTIVE: ['Inactiva', 'gray'],
};

export function statusInfo(code?: string | null): [string, Tone] {
  if (!code) return ['—', 'gray'];
  return MAP[code] ?? [code.charAt(0) + code.slice(1).toLowerCase().replace(/_/g, ' '), 'gray'];
}

export const PRIORITY: Record<string, [string, Tone]> = {
  LOW: ['Baja', 'gray'],
  NORMAL: ['Media', 'amber'],
  HIGH: ['Alta', 'red'],
  CRITICAL: ['Crítica', 'red'],
};
