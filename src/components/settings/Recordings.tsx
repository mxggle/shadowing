import { useEffect, useState } from "react";
import { api, type RecordingSpace } from "../../lib/api";
import { Button } from "../ui";
import { formatBytes } from "./LocalModels";

/** 录音: how much room your takes and readings take, and clearing those of audio that's gone. */
export function RecordingsRow() {
  const [space, setSpace] = useState<RecordingSpace | null>(null);
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    api.record.space().then(setSpace, () => setSpace(null));
  }, []);
  if (!space) return null;

  const clear = async () => {
    setBusy(true);
    try {
      setSpace(await api.record.clearMissing());
      setError(null);
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
      setConfirm(false);
    }
  };
  const size = (bytes: number) => (bytes > 0 && bytes < 1e6 ? "不到 1 MB" : formatBytes(bytes));
  return (
    <div className="flex items-center gap-4 py-3">
      <div className="min-w-0 flex-1">
        <h4 className="text-[13px] font-medium">
          {space.bytes ? (
            <>
              录音占用 <span className="font-mono tabular">{size(space.bytes)}</span>
            </>
          ) : (
            "还没有录音"
          )}
        </h4>
        <p className={`mt-0.5 text-[12px] leading-relaxed ${error ? "text-danger" : "text-muted"}`}>
          {error ??
            (space.missingTracks
              ? `其中 ${space.missingTracks} 个音频已经找不到了（移走或删掉了），它们的录音占 ${size(space.missingBytes)}。外接硬盘没接上时不算找不到。`
              : "跟读录音和整段录音存在这台 Mac 的应用数据里，不会写到音频旁边。")}
        </p>
      </div>
      {space.missingTracks > 0 &&
        (confirm ? (
          <Button primary disabled={busy} onClick={() => void clear()}>
            确定删除
          </Button>
        ) : (
          <Button onClick={() => setConfirm(true)}>删除这些录音</Button>
        ))}
    </div>
  );
}
