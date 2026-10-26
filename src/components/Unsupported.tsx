import { AlertCircle } from "lucide-react";
import { t } from "../lib/i18n";
import { useApp } from "../store";
import { Button } from "./ui";

/** A WebM or MKV from the list: why it can't play, and what to do instead. */
export function Unsupported() {
  const track = useApp((s) => s.current)!;
  const format = (track.path.split(".").pop() ?? "").toUpperCase();
  return (
    <div className="scrollbar-none flex min-h-0 flex-1 flex-col overflow-y-auto">
      <div key={track.path} className="mx-auto w-full max-w-[760px] animate-fade-in px-10 pt-1 pb-10">
        <h1 className="line-clamp-2 font-script text-[28px] leading-[1.22] font-semibold tracking-[-0.012em] break-words text-balance">{track.name}</h1>
        <p className="mt-1 text-[12px] text-faint">{t("{format} 视频", { format })}</p>
        <section className="mt-8 flex max-w-[520px] flex-col gap-3 rounded-[12px] px-5 py-4 ring-1 ring-line">
          <h2 className="flex items-center gap-2 font-heading text-[17px] font-semibold">
            <AlertCircle size={17} className="shrink-0 text-warn" />
            {t("这个视频放不了")}
          </h2>
          <p className="text-[14px] leading-relaxed text-muted">
            {t("这种视频里的声音多半是 Opus 格式，应用的播放器还解不了。能放的视频是 mp4、m4v、mov（画面 H.264，声音 AAC）。")}
          </p>
          <ul className="list-disc pl-[18px] text-[13px] leading-[1.8] text-muted">
            <li>{t("从 YouTube 下载的：可以用「从链接导入」重新下载，选「声音 + 画面」就存成 mp4。")}</li>
            <li>{t("或者用 HandBrake 之类的工具转成 mp4，放进这个文件夹再打开。")}</li>
          </ul>
          <div>
            <Button onClick={() => void useApp.getState().openImport()}>{t("从链接导入…")}</Button>
          </div>
        </section>
      </div>
    </div>
  );
}
