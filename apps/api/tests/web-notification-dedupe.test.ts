import { describe, expect, it } from "vitest";
import {
  acceptRecentEvent,
  decisionToastEventKey,
  requestNotificationEventKey,
} from "../../web/src/utils/recentEventDedupe";
import { tryAcquireActionLock } from "../../web/src/utils/actionLock";

describe("Web notification event deduplication", () => {
  it("displays the same socket event only once across refetch/reconnect deliveries", () => {
    const recentEvents = new Set<string>();

    expect(acceptRecentEvent(recentEvents, "leave-request:req-1")).toBe(true);
    expect(acceptRecentEvent(recentEvents, "leave-request:req-1")).toBe(false);
    expect(acceptRecentEvent(recentEvents, "leave-request:req-2")).toBe(true);
  });

  it("does not suppress a new business event or a notification without an id", () => {
    const recentEvents = new Set<string>();

    expect(acceptRecentEvent(recentEvents, "wfh-request:req-1:submission-1")).toBe(true);
    expect(acceptRecentEvent(recentEvents, "wfh-request:req-1:submission-2")).toBe(true);
    expect(acceptRecentEvent(recentEvents, undefined)).toBe(true);
  });

  it("deduplicates WFH and leave requests by stable request or submission ID", () => {
    const recentEvents = new Set<string>();
    const wfhSubmission = requestNotificationEventKey("wfh", "req-7:submission-1");
    const leaveRequest = requestNotificationEventKey("leave", "req-8");

    // Socket delivery followed by a query refetch or reconnect is one event.
    expect(acceptRecentEvent(recentEvents, wfhSubmission)).toBe(true);
    expect(acceptRecentEvent(recentEvents, wfhSubmission)).toBe(false);
    expect(acceptRecentEvent(recentEvents, leaveRequest)).toBe(true);
    expect(acceptRecentEvent(recentEvents, leaveRequest)).toBe(false);
    // A new WFH resubmission is a distinct business event.
    expect(acceptRecentEvent(recentEvents, requestNotificationEventKey("wfh", "req-7:submission-2"))).toBe(true);
  });

  it("gives approvals and rejections distinct keys while repeated delivery stays one toast", () => {
    const recentEvents = new Set<string>();
    const approval = decisionToastEventKey("leave", "req-9", "APPROVED");
    const rejection = decisionToastEventKey("leave", "req-10", "REJECTED");

    expect(acceptRecentEvent(recentEvents, approval)).toBe(true);
    expect(acceptRecentEvent(recentEvents, approval)).toBe(false);
    expect(acceptRecentEvent(recentEvents, rejection)).toBe(true);
    // Toast calls without a dedupe key (including genuine error handlers) are preserved.
    expect(acceptRecentEvent(recentEvents, undefined)).toBe(true);
    expect(acceptRecentEvent(recentEvents, undefined)).toBe(true);
  });

  it("allows one approval submission while repeated clicks are in flight", async () => {
    const lock = { current: false };
    let submissions = 0;
    let releaseRequest: (() => void) | undefined;
    const request = new Promise<void>((resolve) => {
      releaseRequest = resolve;
    });
    const submitOnce = async () => {
      if (!tryAcquireActionLock(lock)) return;
      try {
        submissions += 1;
        await request;
      } finally {
        lock.current = false;
      }
    };

    const firstClick = submitOnce();
    const repeatedClick = submitOnce();
    expect(submissions).toBe(1);
    releaseRequest?.();
    await Promise.all([firstClick, repeatedClick]);
    expect(submissions).toBe(1);
    expect(lock.current).toBe(false);
    expect(tryAcquireActionLock(lock)).toBe(true);
  });

});
