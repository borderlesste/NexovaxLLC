/**
 * Support response times. The clock pauses while the ticket waits for the customer
 * (status PENDING_CUSTOMER), so an agent isn't measured on time the customer took to answer.
 */
export interface TicketTimes {
  /** Minutes from the report to the team's first answer (null: not answered yet). */
  firstResponseMinutes: number | null;
  /** Net minutes until it was resolved/closed (null: still open). */
  resolutionMinutes: number | null;
  /** Net minutes so far (open tickets) or until resolution. */
  workingMinutes: number;
  /** Minutes spent waiting for the customer (not counted). */
  waitingCustomerMinutes: number;
}

const DONE = new Set(['RESOLVED', 'CLOSED']);
const ms = (d: string | Date) => new Date(d).getTime();
const toMin = (x: number) => Math.max(0, Math.round(x / 60_000));

export function ticketTimes(
  t: { createdAt: string | Date; firstResponseAt?: string | Date | null; status: string },
  history: { to: string; at: string | Date }[],
  now: Date = new Date(),
): TicketTimes {
  const start = ms(t.createdAt);
  const steps = [...history].filter((h) => h.at && ms(h.at) >= start).sort((a, b) => ms(a.at) - ms(b.at));
  // Resolution = when the ticket entered its current resolved/closed state (a reopen resets it).
  let resolvedAt: number | null = null;
  if (DONE.has(t.status)) {
    for (let i = steps.length - 1; i >= 0 && DONE.has(steps[i].to); i--) resolvedAt = ms(steps[i].at);
    resolvedAt ??= steps.length ? ms(steps[steps.length - 1].at) : now.getTime();
  }
  const end = resolvedAt ?? now.getTime();
  let waiting = 0;
  let status = 'OPEN';
  let since = start;
  for (const s of steps) {
    const at = Math.min(ms(s.at), end);
    if (status === 'PENDING_CUSTOMER') waiting += at - since;
    status = s.to;
    since = at;
    if (at >= end) break;
  }
  if (status === 'PENDING_CUSTOMER' && since < end) waiting += end - since;
  const working = end - start - waiting;
  return {
    firstResponseMinutes: t.firstResponseAt ? toMin(ms(t.firstResponseAt) - start) : null,
    resolutionMinutes: resolvedAt != null ? toMin(working) : null,
    workingMinutes: toMin(working),
    waitingCustomerMinutes: toMin(waiting),
  };
}
