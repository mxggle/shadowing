import { FolderOpen, Pause, Play, Repeat } from "lucide-react";
import { useApp } from "../../store";
import { TextLink } from "../ui";

const LANGUAGES: [string, string][] = [
  ["ja", "日语"],
  ["en", "英语"],
  ["other", "其他语言"],
];

/**
 * Shown while no folder is open. The first time it asks what you're learning
 * and offers a one-minute practice on a sample clip; afterwards it's just
 * "open a folder" (with the practice still a click away).
 */
export function Welcome() {
  const guide = useApp((s) => s.guide);
  const missing = useApp((s) => s.missingFolder);
  const { chooseFolder, startPractice, saveGuide, setTranscribeLanguage } = useApp.getState();
  const first = !guide.welcomed;

  function pickLanguage(language: string) {
    saveGuide({ language });
    // Also the default for transcribing (until one is picked there).
    if (!useApp.getState().settings.transcribeLanguage && language !== "other") setTranscribeLanguage(language);
  }

  return (
    <div data-tauri-drag-region className="flex h-full items-center justify-center overflow-y-auto bg-paper px-10 py-12">
      <div className="grid w-full max-w-[880px] animate-fade-in items-center gap-14 min-[880px]:grid-cols-[1fr_360px]">
        <div className="flex flex-col items-start">
          <p className="text-[13px] font-semibold tracking-[0.01em] text-muted">Shadowing</p>
          <h1 className="mt-3 font-heading text-[34px] leading-[1.25] font-semibold tracking-[-0.015em] text-balance">
            反复听、放慢，
            <br />
            一句一句跟读。
          </h1>
          <p className="mt-3 text-[15px] leading-relaxed text-muted">用你自己的音频练习，不需要联网。</p>
          {missing && (
            <p className="mt-4 rounded-[8px] bg-danger-soft px-3 py-1.5 text-[12px] break-all text-danger">上次的文件夹无法打开：{missing}</p>
          )}

          {first ? (
            <>
              <h2 className="mt-9 text-[13px] font-medium text-muted">你在学哪种语言？</h2>
              <div role="radiogroup" aria-label="学习语言" className="well mt-2.5 flex gap-1 rounded-[11px] p-1">
                {LANGUAGES.map(([code, label]) => {
                  const on = guide.language === code;
                  return (
                    <button
                      key={code}
                      role="radio"
                      aria-checked={on}
                      onClick={() => pickLanguage(code)}
                      className={`h-8 rounded-[8px] px-4 text-[13px] transition-[background-color,color,box-shadow] duration-150 ${
                        on ? "bg-raised font-medium text-fg shadow-cap" : "text-muted hover:text-fg"
                      }`}
                    >
                      {label}
                    </button>
                  );
                })}
              </div>
              <BigButton disabled={!guide.language} onClick={() => void startPractice()}>
                <Play size={15} fill="currentColor" strokeWidth={0} /> 用示例练一下
              </BigButton>
              <p className="mt-2.5 text-[12px] text-faint">约 1 分钟：播放、放慢、循环一句、跟读。</p>
              <TextLink className="mt-7" onClick={() => void chooseFolder()}>
                跳过，直接打开我的音频文件夹
              </TextLink>
            </>
          ) : (
            <>
              <BigButton onClick={() => void chooseFolder()}>
                <FolderOpen size={16} strokeWidth={1.9} /> 打开文件夹
              </BigButton>
              <TextLink className="mt-5" onClick={() => void startPractice()}>
                先用示例练一下
              </TextLink>
            </>
          )}
        </div>
        <Preview language={guide.language === "en" ? "en" : "ja"} />
      </div>
    </div>
  );
}

function BigButton(props: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      {...props}
      className="key-ink mt-8 flex h-11 items-center gap-2 rounded-[12px] px-5 text-[14px] font-medium disabled:pointer-events-none"
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
function Preview({ language }: { language: "ja" | "en" }) {
  const lines = PREVIEW[language];
  return (
    <figure aria-hidden className="pointer-events-none hidden overflow-hidden rounded-[18px] bg-raised shadow-cap min-[880px]:block">
      <div key={language} className="flex animate-fade flex-col gap-1 px-3 pt-4 pb-3">
        {lines.map(([time, text], i) => {
          const looping = i === 1;
          return (
            <div key={time} className={`grid grid-cols-[2.5rem_1fr_auto] items-start gap-x-2 rounded-[10px] px-2 py-1.5 ${looping ? "bg-loop-soft" : ""}`}>
              <span className={`tabular pt-[5px] font-mono text-[10.5px] ${looping ? "text-loop-text" : "text-faint"}`}>{time}</span>
              <p className={`font-script text-[14.5px] leading-[24px] ${looping ? "text-fg" : "text-muted"}`}>{text}</p>
              {looping ? (
                <span className="flex h-6 items-center gap-1 font-mono text-[10.5px] text-loop-text">
                  第 3 遍 <Repeat size={12} strokeWidth={2.2} className="text-loop" />
                </span>
              ) : (
                <span />
              )}
            </div>
          );
        })}
      </div>
      <div className="flex items-center gap-2 border-t border-line bg-deck px-4 py-3">
        <span className="key flex h-7 items-center gap-1.5 rounded-[8px] px-2.5 text-[11px] font-medium text-loop-text" aria-pressed="true">
          <span className="size-[6px] rounded-full bg-loop shadow-[var(--led-glow)]" />
          循环第 2 句
        </span>
        <span className="key-ink ml-auto grid h-8 w-10 place-items-center rounded-[10px]">
          <Pause size={13} fill="currentColor" strokeWidth={0} />
        </span>
        <span className="well ml-auto rounded-[8px] px-2 py-1 font-mono text-[10.5px] text-fg">0.75×</span>
      </div>
    </figure>
  );
}
