const ADMISSION_TIME_ZONE = "Asia/Hong_Kong";

export function currentAdmissionDate(now = new Date()): string {
  const parts = new Intl.DateTimeFormat("en", {
    timeZone: ADMISSION_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(now);
  const value = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
  return `${value("year")}-${value("month")}-${value("day")}`;
}

export function currentAdmissionYear(now = new Date()): number {
  return Number(currentAdmissionDate(now).slice(0, 4));
}

export function isAdmissionPlanSeason(now = new Date()): boolean {
  const month = Number(currentAdmissionDate(now).slice(5, 7));
  return month >= 5 && month <= 8;
}

export function isAdmissionScoreReleaseSeason(now = new Date()): boolean {
  const month = Number(currentAdmissionDate(now).slice(5, 7));
  return month >= 7 && month <= 10;
}

export function defaultAdmissionPlanYears(now = new Date()): number[] {
  return [currentAdmissionYear(now)];
}

export function defaultAdmissionScoreYears(now = new Date()): number[] {
  const year = currentAdmissionYear(now);
  if (isAdmissionScoreReleaseSeason(now)) return [year, year - 1, year - 2, year - 3];
  return [year - 1, year - 2, year - 3];
}

export function defaultAdmissionScoreYearRange(now = new Date()): string {
  const years = defaultAdmissionScoreYears(now).slice().sort((left, right) => left - right);
  return `${years[0]}-${years[years.length - 1]}`;
}

export function defaultAdmissionPlanIntervalHours(now = new Date()): number {
  return isAdmissionPlanSeason(now) ? 24 : 168;
}

export function defaultAdmissionScoreIntervalHours(now = new Date()): number {
  return isAdmissionScoreReleaseSeason(now) ? 24 : 720;
}
