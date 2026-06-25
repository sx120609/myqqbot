import { describe, expect, it } from "vitest";
import {
  currentAdmissionDate,
  currentAdmissionYear,
  defaultAdmissionPlanIntervalHours,
  defaultAdmissionPlanYears,
  defaultAdmissionScoreIntervalHours,
  defaultAdmissionScoreYearRange,
  defaultAdmissionScoreYears,
  isAdmissionPlanSeason,
  isAdmissionScoreReleaseSeason
} from "./admission-calendar.js";

describe("admission calendar", () => {
  it("derives current plan and historical score years from the runtime date", () => {
    const now = new Date("2026-06-26T01:20:00+08:00");

    expect(currentAdmissionDate(now)).toBe("2026-06-26");
    expect(currentAdmissionYear(now)).toBe(2026);
    expect(isAdmissionPlanSeason(now)).toBe(true);
    expect(isAdmissionScoreReleaseSeason(now)).toBe(false);
    expect(defaultAdmissionPlanYears(now)).toEqual([2026]);
    expect(defaultAdmissionScoreYears(now)).toEqual([2025, 2024, 2023]);
    expect(defaultAdmissionScoreYearRange(now)).toBe("2023-2025");
    expect(defaultAdmissionPlanIntervalHours(now)).toBe(24);
    expect(defaultAdmissionScoreIntervalHours(now)).toBe(720);
  });

  it("includes the current score year and daily score sync during admission release season", () => {
    const now = new Date("2026-08-05T12:00:00+08:00");

    expect(isAdmissionPlanSeason(now)).toBe(true);
    expect(isAdmissionScoreReleaseSeason(now)).toBe(true);
    expect(defaultAdmissionScoreYears(now)).toEqual([2026, 2025, 2024, 2023]);
    expect(defaultAdmissionScoreYearRange(now)).toBe("2023-2026");
    expect(defaultAdmissionPlanIntervalHours(now)).toBe(24);
    expect(defaultAdmissionScoreIntervalHours(now)).toBe(24);
  });

  it("uses weekly plan sync outside the admission plan season", () => {
    const now = new Date("2026-12-05T12:00:00+08:00");

    expect(isAdmissionPlanSeason(now)).toBe(false);
    expect(isAdmissionScoreReleaseSeason(now)).toBe(false);
    expect(defaultAdmissionPlanIntervalHours(now)).toBe(168);
    expect(defaultAdmissionScoreIntervalHours(now)).toBe(720);
  });
});
