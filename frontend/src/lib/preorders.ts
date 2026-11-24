import { t } from '@/lib/i18n';

export interface PreorderOffer {
  offerId: string;
  variantId: string;
  arrivalAt: string;
  capacity: number;
  remaining: number;
}

export type SellerPreorderOffer = PreorderOffer & {
  reserved: number;
  maxArrivalAt: string;
  status: 'OPEN' | 'IN_STOCK' | 'EXPIRED' | 'CLOSED';
};

export interface PreorderReservation {
  id: string;
  offerId: string;
  variantId: string;
  productId: string;
  productTitle: string;
  productSlug: string;
  variantTitle: string | null;
  quantity: number;
  arrivalAt: string;
  status: 'RESERVED' | 'CANCELLED' | 'IN_STOCK' | 'EXPIRED' | 'CLOSED';
}

export const preorderLabels = () => ({
  title: t('Preorden · Próximamente en stock'),
  arrival: t('Llegada estimada al inventario'),
  capacity: t('Unidades para reservar'),
  reserved: t('Unidades reservadas'),
  remaining: t('Cupos disponibles'),
  draft: t('Guarda el borrador para configurar la fecha de llegada y los cupos por variante.'),
  sellerHint: t('Elige una variante sin existencias. Indica su fecha de llegada en los próximos cinco días y cuántas unidades podrán reservarse.'),
  invalidArrival: t('Elige una fecha y hora futura dentro de los próximos cinco días.'),
  invalidCapacity: t('Indica un número entero entre 1 y 1.000.000.'),
  save: t('Guardar preorden'),
  saved: t('Preorden guardada.'),
  close: t('Cerrar preorden'),
  closeHint: t('Se cerrarán las reservas pendientes de esta variante.'),
  reserve: t('Reservar sin pago'),
  change: t('Actualizar mi reserva'),
  reservedSuccess: t('Reserva guardada.'),
  paymentHint: t('La reserva es gratuita. Cuando llegue el inventario, podrás comprar si hay stock disponible.'),
  full: t('Ya no quedan cupos para reservar.'),
  account: t('Mis reservas'),
  empty: t('Todavía no tienes reservas.'),
  cancel: t('Cancelar reserva'),
  cancelHint: t('Al cancelar, liberarás el cupo reservado.'),
  OPEN: t('Abierta'),
  RESERVED: t('Reservada'),
  IN_STOCK: t('Llegó al inventario'),
  CLOSED: t('Cerrada'),
  EXPIRED: t('Vencida'),
  CANCELLED: t('Cancelada'),
});
