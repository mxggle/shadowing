import { FolderOpen, Play } from "lucide-react";
import { useApp } from "../../store";

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
    <div data-tauri-drag-region className="flex h-full items-center justify-center p-8">
      <div className="flex w-full max-w-sm animate-fade-in flex-col items-start">
        <h1 className="text-[32px] font-semibold tracking-tight">Shadowing</h1>
        <p className="mt-2 text-[15px] leading-relaxed text-muted">
          反复听、放慢、一句一句跟读。
          <br />
          用你自己的音频练习，不需要联网。
        </p>
        {missing && (
          <p className="mt-4 rounded-lg bg-danger-soft px-3 py-1.5 text-xs break-all text-danger">上次的文件夹无法打开：{missing}</p>
        )}

        {first ? (
          <>
            <h2 className="mt-8 text-[13px] font-medium text-muted">你在学哪种语言？</h2>
            <div role="radiogroup" aria-label="学习语言" className="mt-2 flex gap-1.5">
              {LANGUAGES.map(([code, label]) => (
                <button
                  key={code}
                  role="radio"
                  aria-checked={guide.language === code}
                  onClick={() => pickLanguage(code)}
                  className={`h-9 rounded-lg px-4 text-[14px] transition-[background-color,color,scale] duration-150 ease-snappy active:scale-[0.96] ${
                    guide.language === code ? "bg-ink font-medium text-on-ink" : "bg-hover hover:bg-press"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
            <BigButton disabled={!guide.language} onClick={() => void startPractice()}>
              <Play size={16} /> 用示例练一下
            </BigButton>
            <p className="mt-2 text-[12px] text-faint">约 1 分钟：播放、放慢、循环一句、跟读。</p>
            <button
              onClick={() => void chooseFolder()}
              className="mt-6 text-[13px] text-muted underline decoration-fg/25 underline-offset-2 hover:text-fg hover:decoration-fg"
            >
              跳过，直接打开我的音频文件夹
            </button>
          </>
        ) : (
          <>
            <BigButton onClick={() => void chooseFolder()}>
              <FolderOpen size={17} /> 打开文件夹
            </BigButton>
            <button
              onClick={() => void startPractice()}
              className="mt-4 text-[13px] text-muted underline decoration-fg/25 underline-offset-2 hover:text-fg hover:decoration-fg"
            >
              先用示例练一下
            </button>
          </>
        )}
      </div>
    </div>
  );
}

function BigButton(props: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      {...props}
      className="mt-7 flex h-10 items-center gap-2 rounded-xl bg-ink px-5 text-[14px] font-medium text-on-ink transition-[opacity,scale] duration-150 ease-snappy hover:opacity-85 active:scale-[0.96] disabled:pointer-events-none disabled:opacity-35"
    />
  );
}
