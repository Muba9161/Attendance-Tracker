/** Returns true once per stable event key, retaining only the most recent 1000 keys. */
export function acceptRecentEvent(
  recentEvents: Set<string>,
  eventId: string | undefined
): boolean {
  if (!eventId) return true;
  if (recentEvents.has(eventId)) return false;
  recentEvents.add(eventId);
  if (recentEvents.size > 1000) {
    const oldestEvent = recentEvents.values().next().value;
    if (oldestEvent !== undefined) recentEvents.delete(oldestEvent);
  }
  return true;
}

export function requestNotificationEventKey(
  kind: "wfh" | "leave",
  requestId: string
): string {
  return `${kind}-request:${requestId}`;
}

export function decisionToastEventKey(
  kind: "wfh" | "leave",
  requestId: string,
  status: "APPROVED" | "REJECTED"
): string {
  return `${kind}-decision:${requestId}:${status}`;
}
