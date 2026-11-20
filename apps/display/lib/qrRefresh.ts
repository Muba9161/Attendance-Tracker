/** Schedule a final REST refresh at the challenge deadline as a safety net. */
export function scheduleExpiryRefresh(
  deadline: number,
  onExpire: () => void
): ReturnType<typeof setTimeout> {
  return setTimeout(() => {
    if (Date.now() >= deadline) onExpire();
  }, Math.max(0, deadline - Date.now()));
}

/** True only when a response is strictly newer than the currently displayed challenge. */
export function isNewerChallenge(incomingIssuedAt: string, currentIssuedAt?: string): boolean {
  if (!currentIssuedAt) return true;
  const incoming = Date.parse(incomingIssuedAt);
  const current = Date.parse(currentIssuedAt);
  return Number.isFinite(incoming) && Number.isFinite(current) && incoming > current;
}

export function shouldRefreshOnSocketConnect(
  hasChallenge: boolean,
  expiryDeadline: number | null,
  now: number,
  retryPending: boolean
): boolean {
  return !retryPending && (!hasChallenge || expiryDeadline === null || expiryDeadline <= now + 5_000);
}

export function getRefreshRetryDelay(attempt: number): number {
  const safeAttempt = Math.max(1, Math.floor(attempt));
  return Math.min(1_000 * 2 ** Math.min(safeAttempt - 1, 10), 30_000);
}
