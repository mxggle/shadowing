import { AlertCircle } from "lucide-react";
import { t } from "../lib/i18n";
import { formatDuration } from "../lib/practice";
import { useApp } from "../store";

/**
 * The track's name over the main area, and how long it has been practised.
 * `bare`: in a column of its own (a video beside its sentences), without the page's width and margins.
 */
export function TrackTitle({ bare = false }: { bare?: boolean }) {
  const current = useApp((s) => s.current)!;
  const error = useApp((s) => s.error);
  // A video's title keeps to one smaller line: the picture under it needs the room.
  const picture = useApp((s) => s.current?.kind === "video" && !s.settings.pictureHidden && s.pictureLook !== "none");
  const size = picture ? "line-clamp-1 text-[22px] leading-[1.3]" : "line-clamp-2 text-[28px] leading-[1.22]";
  return (
    <div key={current.path} className={`shrink-0 animate-fade-in pt-1 ${bare ? "" : "mx-auto w-full max-w-[760px] px-10"}`}>
      <h1
        className={`${size} font-script font-semibold tracking-[-0.012em] break-words text-balance`}
        title={current.name}
      >
        {current.name}
      </h1>
      <TrackPractice />
      {error && (
        <p className="mt-3 flex w-fit max-w-full items-start gap-1.5 rounded-[8px] bg-danger-soft px-3 py-1.5 text-[13px] text-danger">
          <AlertCircle size={15} className="mt-0.5 shrink-0" />
          <span className="break-words">{error}</span>
        </p>
      )}
    </div>
  );
}

/** How long this audio has been practised in all, once there's at least a minute. */
function TrackPractice() {
  const ms = useApp((s) => s.trackMs);
  if (ms < 60_000) return null;
  return (
    <p className="mt-1 text-[12px] text-faint" title={t("练这段音频的时间（播放和中间的跟读），详见学习记录")}>
      {t("已练")} <span className="tabular text-muted">{formatDuration(ms)}</span>
    </p>
  );
}
