/** Public reference formats shown to people (DB stores plain numbers). */
export const ORDER_PREFIX = 'NX';
export const orderRef = (n: unknown) => `${ORDER_PREFIX}-${n}`;
export const paymentRef = (n: unknown) => `${ORDER_PREFIX}-PAY-${n}`;
export const ticketRef = (n: unknown) => `${ORDER_PREFIX}-REP-${n}`;
export const payoutRef = (n: unknown) => `PO-${n}`;
/** Accepts NX-123, RD-123 (legacy), #123 or 123 and returns the number part. */
export const parseOrderRef = (v: string) => v.trim().replace(/^#?\s*(NX|RD)-?/i, '');
export const parseTicketRef = (v: string) => v.trim().toUpperCase().replace(/^#?\s*(NX|RD)-REP-?/, '').replace(/^REP-?/, '');
