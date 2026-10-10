/** 75.3 -> "1:15", 3725 -> "1:02:05". */
export function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) seconds = 0;
  const s = Math.floor(seconds);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = String(s % 60).padStart(2, "0");
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${sec}` : `${m}:${sec}`;
}

/** 75.34 -> "1:15.3" — for A/B markers where tenths matter. */
export function formatPrecise(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) seconds = 0;
  // Round to tenths first: 12.6 % 1 is 0.5999…, which would floor to "12.5".
  const tenths = Math.round(seconds * 10);
  return `${formatTime(Math.floor(tenths / 10))}.${tenths % 10}`;
}
