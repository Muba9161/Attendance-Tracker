import { describe, expect, it } from "vitest";
import { canCorrectAttendance } from "../../web/src/utils/attendanceCorrectionAccess";

describe("Attendance Ledger correction access", () => {
  it("allows the Correct action for ADMIN only", () => {
    expect(canCorrectAttendance("ADMIN")).toBe(true);
    expect(canCorrectAttendance("HR")).toBe(false);
    expect(canCorrectAttendance("EMPLOYEE")).toBe(false);
    expect(canCorrectAttendance(undefined)).toBe(false);
  });
});
