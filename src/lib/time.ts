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

/** 527.054 -> "8:47.05" — the playhead to the hundredth, for lining subtitles up by ear. */
export function formatHundredths(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) seconds = 0;
  // Floor, like the plain clock: 8:47.999 is still 8:47, not 8:48.00. The tiny bias keeps 2.3 from reading 2.29.
  const cs = Math.floor(seconds * 100 + 1e-6);
  return `${formatTime(Math.floor(cs / 100))}.${String(cs % 100).padStart(2, "0")}`;
}
