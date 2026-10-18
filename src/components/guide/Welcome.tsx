import { FolderOpen, Pause, Repeat } from "lucide-react";
import { t } from "../../lib/i18n";
import { useApp } from "../../store";
import { TextLink } from "../ui";
import { Onboarding } from "./Onboarding";

/**
 * Shown while no folder is open. The first time it is the onboarding;
 * afterwards it's just "open a folder" (with the practice still a click away).
 */
export function Welcome() {
  const guide = useApp((s) => s.guide);
  return guide.welcomed ? <Returning /> : <Onboarding />;
}

function Returning() {
  const guide = useApp((s) => s.guide);
  const missing = useApp((s) => s.missingFolder);
  const { chooseFolder, startPractice } = useApp.getState();

  return (
    <div data-tauri-drag-region className="scrollbar-none flex h-full items-center justify-center overflow-y-auto bg-paper px-10 py-12">
      <div className="grid w-full max-w-[880px] animate-fade-in items-center gap-14 min-[880px]:grid-cols-[1fr_360px]">
        <div className="flex flex-col items-start">
          <p className="text-[13px] font-semibold tracking-[0.01em] text-muted">Shadowing</p>
          <h1 className="mt-3 font-heading text-[34px] leading-[1.25] font-semibold tracking-[-0.015em] text-balance">
            {t("反复听、放慢，", "Listen again, slow down,")}
            <br />
            {t("一句一句跟读。", "repeat line by line.")}
          </h1>
          <p className="mt-3 text-[15px] leading-relaxed text-muted">{t("用你自己的音频练习，不需要联网。", "Practice with your own audio. No internet needed.")}</p>
          {missing && (
            <p className="mt-4 rounded-[8px] bg-danger-soft px-3 py-1.5 text-[12px] break-all text-danger">
              {t("上次的文件夹无法打开：", "Couldn’t open the last folder: ")}
              {missing}
            </p>
          )}
          <BigButton onClick={() => void chooseFolder()}>
            <FolderOpen size={16} strokeWidth={1.9} /> {t("打开文件夹", "Open Folder")}
          </BigButton>
          <TextLink className="mt-5" onClick={() => void startPractice()}>
            {t("先用示例练一下", "Try the sample first")}
          </TextLink>
        </div>
        <Preview language={guide.language === "en" ? "en" : "ja"} />
      </div>
    </div>
  );
}

export function BigButton(props: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      {...props}
      className="btn-ink mt-8 flex h-11 items-center gap-2 rounded-[12px] px-5 text-[14px] font-medium disabled:pointer-events-none"
    />
  );
}

const PREVIEW: Record<"ja" | "en", [string, string][]> = {
  ja: [
    ["0:00", "これは、私が小さいときに、村の茂平というおじいさんからきいたお話です。"],
    ["0:18", "その中山から、少しはなれた山の中に、「ごん狐」という狐がいました。"],
    ["0:25", "ごんは、一人ぼっちの小狐で、しだの一ぱいしげった森の中に穴をほって住んでいました。"],
  ],
  en: [
    ["0:00", "Once upon a time there were four little Rabbits."],
    ["0:06", "They lived with their Mother in a sand-bank, underneath the root of a very big fir-tree."],
    ["0:19", "Your Father had an accident there; he was put in a pie by Mrs. McGregor."],
  ],
};

/**
 * What practising looks like, drawn with the real pieces: a script with the
 * middle sentence looping, and the deck below it. Not interactive.
 */
export function Preview({ language }: { language: "ja" | "en" }) {
  const lines = PREVIEW[language];
  return (
    <figure aria-hidden className="pointer-events-none hidden overflow-hidden rounded-[18px] bg-raised shadow-[0_0_0_1px_var(--line-strong)] min-[880px]:block">
      <div key={language} className="flex animate-fade flex-col gap-1 px-3 pt-4 pb-3">
        {lines.map(([time, text], i) => {
          const looping = i === 1;
          return (
            <div key={time} className={`grid grid-cols-[2.5rem_1fr_auto] items-start gap-x-2 rounded-[10px] px-2 py-1.5 ${looping ? "bg-loop-soft" : ""}`}>
              <span className={`tabular pt-[5px] font-mono text-[10.5px] ${looping ? "text-loop-text" : "text-faint"}`}>{time}</span>
              <p className={`font-script text-[14.5px] leading-[24px] ${looping ? "text-fg" : "text-muted"}`}>{text}</p>
              {looping ? (
                <span className="flex h-6 items-center gap-1 font-mono text-[10.5px] text-loop-text">
                  {t("第 3 遍", "Take 3")} <Repeat size={12} strokeWidth={2.2} className="text-loop" />
                </span>
              ) : (
                <span />
              )}
            </div>
          );
        })}
      </div>
      <div className="flex items-center gap-2 border-t border-line bg-deck px-4 py-3">
        <span className="flex h-7 items-center gap-1.5 rounded-[8px] bg-loop-soft px-2.5 text-[11px] font-medium text-loop-text">
          <span className="size-[7px] rounded-full bg-loop" />
          {t("循环第 2 句", "Looping sentence 2")}
        </span>
        <span className="btn-ink ml-auto grid size-8 place-items-center rounded-full">
          <Pause size={13} fill="currentColor" strokeWidth={0} />
        </span>
        <span className="tint ml-auto rounded-[8px] px-2 py-1 font-mono text-[10.5px] text-fg">0.75×</span>
      </div>
    </figure>
  );
}
