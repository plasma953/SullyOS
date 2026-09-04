import { describe, expect, it } from "vitest";
import { isPhoneAutoRefreshDue } from "./phoneAutoRefresh";

const char = (ps: unknown) => ({ id: "c1", phoneState: ps } as never);

describe("isPhoneAutoRefreshDue", () => {
  it("returns false when autoRefresh off", () => {
    expect(isPhoneAutoRefreshDue(char(undefined))).toBe(false);
    expect(isPhoneAutoRefreshDue(char({ autoRefresh: false }), Date.now())).toBe(false);
  });
  it("uses default 30min interval", () => {
    const now = 1000000000;
    expect(isPhoneAutoRefreshDue(char({ autoRefresh: true, lastAutoRefreshAt: 0 }), now)).toBe(true);
    expect(isPhoneAutoRefreshDue(char({ autoRefresh: true, lastAutoRefreshAt: now - 29 * 60_000 }), now)).toBe(false);
    expect(isPhoneAutoRefreshDue(char({ autoRefresh: true, lastAutoRefreshAt: now - 30 * 60_000 }), now)).toBe(true);
  });
  it("respects custom interval", () => {
    const now = 2000000000;
    expect(isPhoneAutoRefreshDue(char({ autoRefresh: true, autoRefreshIntervalMin: 15, lastAutoRefreshAt: now - 14 * 60_000 }), now)).toBe(false);
    expect(isPhoneAutoRefreshDue(char({ autoRefresh: true, autoRefreshIntervalMin: 15, lastAutoRefreshAt: now - 15 * 60_000 }), now)).toBe(true);
  });
});
