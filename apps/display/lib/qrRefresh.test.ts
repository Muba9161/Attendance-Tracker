import { afterEach, describe, expect, it, vi } from "vitest";
import { getRefreshRetryDelay, isNewerChallenge, scheduleExpiryRefresh, shouldRefreshOnSocketConnect } from "./qrRefresh";

describe("display QR refresh lifecycle helpers", () => {
  afterEach(() => vi.useRealTimers());

  it("accepts the initial challenge when there is no current challenge", () => {
    expect(isNewerChallenge("2026-11-18T10:00:00.000Z")).toBe(true);
  });

  it("rejects an older response so it cannot replace a newer QR", () => {
    expect(isNewerChallenge("2026-11-18T10:00:00.000Z", "2026-11-18T10:00:01.000Z")).toBe(false);
  });

  it("accepts a later challenge response", () => {
    expect(isNewerChallenge("2026-11-18T10:00:02.000Z", "2026-11-18T10:00:01.000Z")).toBe(true);
  });

  it("rejects invalid issue times", () => {
    expect(isNewerChallenge("invalid", "2026-11-18T10:00:01.000Z")).toBe(false);
  });

  it("does not fire the expiry recovery timer early", () => {
    vi.useFakeTimers();
    const now = Date.now();
    const recover = vi.fn();
    scheduleExpiryRefresh(now + 1000, recover);
    vi.advanceTimersByTime(999);
    expect(recover).not.toHaveBeenCalled();
  });

  it("requests a fresh challenge at expiry", () => {
    vi.useFakeTimers();
    const recover = vi.fn();
    scheduleExpiryRefresh(Date.now() + 1000, recover);
    vi.advanceTimersByTime(1000);
    expect(recover).toHaveBeenCalledTimes(1);
  });

  it("recovers immediately when a challenge is already expired", () => {
    vi.useFakeTimers();
    const recover = vi.fn();
    scheduleExpiryRefresh(Date.now() - 1, recover);
    vi.runOnlyPendingTimers();
    expect(recover).toHaveBeenCalledTimes(1);
  });

  it("allows callers to cancel an expiry timer during cleanup", () => {
    vi.useFakeTimers();
    const recover = vi.fn();
    const timer = scheduleExpiryRefresh(Date.now() + 1000, recover);
    clearTimeout(timer);
    vi.advanceTimersByTime(1000);
    expect(recover).not.toHaveBeenCalled();
  });

  it("does not request another challenge on reconnect while the current QR is usable", () => {
    expect(shouldRefreshOnSocketConnect(true, 50_000, 10_000, false)).toBe(false);
  });

  it("requests a challenge on reconnect when no usable QR exists", () => {
    expect(shouldRefreshOnSocketConnect(false, null, 10_000, false)).toBe(true);
  });

  it("does not duplicate a scheduled retry when the socket reconnects", () => {
    expect(shouldRefreshOnSocketConnect(false, null, 10_000, true)).toBe(false);
  });

  it("backs off transient errors and caps retry delay at thirty seconds", () => {
    expect(getRefreshRetryDelay(1)).toBe(1000);
    expect(getRefreshRetryDelay(2)).toBe(2000);
    expect(getRefreshRetryDelay(20)).toBe(30_000);
  });
});
