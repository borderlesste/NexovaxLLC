/**
 * Security controls an administrator can tune (Admin → Configuración → Seguridad).
 * Every value is clamped to a safe range so a typo can never switch a protection off entirely.
 */
export interface SecurityControls {
  /** Days a delivered order's seller funds stay pending before they can be paid out (dispute window). */
  payoutHoldDays: number;
  /** Hours an unpaid bank-transfer order keeps its inventory reserved. */
  bankTransferReserveHours: number;
  /** Most unpaid bank-transfer orders one buyer may have open at once. */
  bankTransferMaxOpenOrders: number;
  /** Password-recovery e-mails per address per hour. */
  passwordRecoveryPerHour: number;
  /** Days «Identidad verificada» documents are kept after the decision, then deleted. */
  identityDocRetentionDays: number;
  /** Distinct non-existent coupon codes one buyer may try per hour before coupons are refused (code guessing). */
  couponFailedAttemptsPerHour: number;
  /** Ofertas: days before a store can send another campaign for the same product. */
  offerProductCooldownDays: number;
  /** Ofertas: days a buyer who got an offer from a store won't get another one from that store. */
  offerPerStoreDays: number;
  /** Ofertas: most offers (all stores) one buyer receives in 7 days. */
  offerMaxPerBuyerWeek: number;
  /** Ofertas: most buyers one campaign reaches. */
  offerMaxRecipients: number;
}

export const SECURITY_CONTROL_LIMITS: Record<keyof SecurityControls, [min: number, max: number, def: number]> = {
  payoutHoldDays: [1, 90, 7],
  bankTransferReserveHours: [1, 72, 24],
  bankTransferMaxOpenOrders: [1, 20, 3],
  passwordRecoveryPerHour: [1, 10, 3],
  identityDocRetentionDays: [7, 180, 30],
  couponFailedAttemptsPerHour: [3, 50, 10],
  offerProductCooldownDays: [1, 90, 7],
  offerPerStoreDays: [1, 90, 7],
  offerMaxPerBuyerWeek: [1, 20, 3],
  offerMaxRecipients: [100, 50000, 5000],
};

export const DEFAULT_SECURITY_CONTROLS: SecurityControls = Object.fromEntries(
  Object.entries(SECURITY_CONTROL_LIMITS).map(([k, [, , d]]) => [k, d]),
) as unknown as SecurityControls;

export function normalizeSecurityControls(v: unknown): SecurityControls {
  const out: any = {};
  for (const [k, [min, max, def]] of Object.entries(SECURITY_CONTROL_LIMITS)) {
    const n = Number((v as any)?.[k]);
    out[k] = Number.isFinite(n) ? Math.min(max, Math.max(min, Math.round(n))) : def;
  }
  return out;
}

/** Strict validation for an admin save: rejects out-of-range values instead of clamping them. */
export function invalidSecurityControl(v: unknown): string | null {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return 'security.controls';
  for (const [k, [min, max]] of Object.entries(SECURITY_CONTROL_LIMITS)) {
    const n = (v as any)[k];
    if (n == null) continue;
    if (!Number.isInteger(n) || n < min || n > max) return k;
  }
  for (const k of Object.keys(v)) if (!(k in SECURITY_CONTROL_LIMITS)) return k;
  return null;
}
