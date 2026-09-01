// Turning stored numbers into something a person reads at a glance.

const UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
  ["second", 1],
  ["minute", 60],
  ["hour", 3_600],
  ["day", 86_400],
  ["month", 2_592_000],
  ["year", 31_536_000],
];

/** "just now", "3 hours ago", "last year" — whichever carries the most meaning. */
export function ago(timestamp: number | undefined): string {
  if (timestamp === undefined || timestamp <= 0) return "never";

  const seconds = Math.round((Date.now() - timestamp) / 1000);
  if (seconds < 45) return "just now";

  // The largest unit the gap fills at least one of.
  let chosen = UNITS[0]!;
  for (const unit of UNITS) {
    if (seconds >= unit[1]) chosen = unit;
  }

  const relative = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });
  return relative.format(-Math.round(seconds / chosen[1]), chosen[0]);
}
