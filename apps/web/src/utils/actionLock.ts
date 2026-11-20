/** Acquires a synchronous in-flight guard before starting an async action. */
export function tryAcquireActionLock(lock: { current: boolean }): boolean {
  if (lock.current) return false;
  lock.current = true;
  return true;
}
