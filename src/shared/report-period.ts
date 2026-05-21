export type ReportPeriod = {
  readonly periodStart: string;
  readonly periodEnd: string;
};

const dayMs = 24 * 60 * 60 * 1000;

function dateOnlyUtc(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function getLastCompletedWeekPeriod(now = new Date()): ReportPeriod {
  const todayUtc = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const dayOfWeek = new Date(todayUtc).getUTCDay();
  const daysSinceMonday = (dayOfWeek + 6) % 7;
  const currentWeekStart = todayUtc - daysSinceMonday * dayMs;
  const periodEnd = new Date(currentWeekStart - dayMs);
  const periodStart = new Date(currentWeekStart - 7 * dayMs);
  return {
    periodStart: dateOnlyUtc(periodStart),
    periodEnd: dateOnlyUtc(periodEnd),
  };
}
