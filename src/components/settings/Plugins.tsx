import { useState } from "react";
import { api, type PluginInfo } from "../../lib/api";
import { useApp } from "../../store";
import { Button } from "../ui";
import { formatBytes } from "./LocalModels";

/** 插件: what's installed, removing one, and installing from a folder. */
export function PluginsSection() {
  const plugins = useApp((s) => s.plugins);
  const setPlugins = useApp((s) => s.setPlugins);
  const [error, setError] = useState<string | null>(null);

  const install = async () => {
    try {
      const list = await api.plugins.install();
      if (list) setPlugins(list);
      setError(null);
    } catch (e) {
      setError(String(e));
    }
  };

  return (
    <div className="mt-2 border-t border-line pt-5">
      <h3 className="text-[12px] font-medium text-faint">插件</h3>
      <p className="mt-1 text-[12px] leading-relaxed text-muted">
        插件给应用加上额外的功能，例如粘贴 YouTube 链接导入音频。插件是运行在这台 Mac 上的程序，只安装你信任的插件。
      </p>
      <div className="mt-1 flex flex-col divide-y divide-line">
        {plugins.map((p) => (
          <PluginRow key={p.id} plugin={p} onRemoved={setPlugins} />
        ))}
      </div>
      <div className="mt-3 flex items-center gap-3">
        <Button onClick={() => void install()}>从文件夹安装…</Button>
        {error && <p className="min-w-0 flex-1 text-[12px] leading-relaxed text-danger">{error}</p>}
      </div>
    </div>
  );
}

function PluginRow({ plugin, onRemoved }: { plugin: PluginInfo; onRemoved: (list: PluginInfo[]) => void }) {
  const [confirm, setConfirm] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const remove = async () => {
    try {
      onRemoved(await api.plugins.remove(plugin.id));
    } catch (e) {
      setError(String(e));
      setConfirm(false);
    }
  };
  const detail = plugin.problem ?? error ?? plugin.description;
  return (
    <div className="flex items-center gap-4 py-3">
      <div className="min-w-0 flex-1">
        <h4 className="flex items-baseline gap-2 text-[13px] font-medium">
          <span className="truncate">{plugin.name}</span>
          {plugin.version && <span className="tabular font-mono text-[11px] font-normal text-faint">{plugin.version}</span>}
        </h4>
        <p className={`mt-0.5 text-[12px] leading-relaxed ${plugin.problem || error ? "text-danger" : "text-muted"}`}>{detail}</p>
        <p className="mt-0.5 text-[11px] text-faint">
          {plugin.importers.length > 0 && <>可以导入：{plugin.importers.join("、")} · </>}
          占用 <span className="tabular font-mono">{plugin.bytes < 1e6 ? "不到 1 MB" : formatBytes(plugin.bytes)}</span>
        </p>
      </div>
      {confirm ? (
        <Button primary onClick={() => void remove()}>
          确定删除
        </Button>
      ) : (
        <Button onClick={() => setConfirm(true)}>删除</Button>
      )}
    </div>
  );
}
