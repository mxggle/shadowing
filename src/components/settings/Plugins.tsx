import { useEffect, useRef, useState } from "react";
import { api, type PluginInfo, type PluginOffer } from "../../lib/api";
import { useApp } from "../../store";
import { Button } from "../ui";
import { formatBytes } from "./LocalModels";

/** 插件: what's installed, removing one, and installing from a folder (picked, then confirmed here). */
export function PluginsSection() {
  const plugins = useApp((s) => s.plugins);
  const setPlugins = useApp((s) => s.setPlugins);
  const [offer, setOffer] = useState<PluginOffer | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Opened from 更多导入方式… (the ＋ menu) or an import that needs a plugin: show this part.
  const focus = useApp((s) => s.settingsFocus);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (focus !== "plugins") return;
    ref.current?.scrollIntoView({ block: "start" });
    useApp.setState({ settingsFocus: null });
  }, [focus]);

  const pick = async () => {
    try {
      setOffer(await api.plugins.pick());
      setError(null);
    } catch (e) {
      setOffer(null);
      setError(String(e));
    }
  };
  const install = async () => {
    try {
      setPlugins(await api.plugins.install());
      setError(null);
    } catch (e) {
      setError(String(e));
    }
    setOffer(null);
  };

  return (
    <div ref={ref} className="mt-2 scroll-mt-4 border-t border-line pt-5">
      <h3 className="text-[12px] font-medium text-faint">插件</h3>
      <p className="mt-1 text-[12px] leading-relaxed text-muted">
        插件给应用加上额外的功能，例如粘贴 YouTube 链接导入音频。插件是运行在这台 Mac 上的程序，只安装你信任的插件。
      </p>
      <div className="mt-1 flex flex-col divide-y divide-line">
        {plugins.map((p) => (
          <PluginRow key={p.id} plugin={p} onRemoved={setPlugins} />
        ))}
      </div>
      {offer ? (
        <Offer offer={offer} onInstall={() => void install()} onCancel={() => setOffer(null)} />
      ) : (
        <div className="mt-3 flex items-center gap-3">
          <Button onClick={() => void pick()}>从文件夹安装…</Button>
          {error && <p className="min-w-0 flex-1 text-[12px] leading-relaxed text-danger">{error}</p>}
        </div>
      )}
    </div>
  );
}

/** What a picked plugin is and says it does, before anything is copied in. */
function Offer({ offer, onInstall, onCancel }: { offer: PluginOffer; onInstall: () => void; onCancel: () => void }) {
  const { runs, network } = offer.permissions;
  return (
    <div role="group" aria-label="安装插件" className="mt-3 rounded-[10px] bg-fill px-4 py-3.5">
      <h4 className="flex items-baseline gap-2 text-[13px] font-medium">
        安装插件「{offer.name}」？
        <span className="tabular font-mono text-[11px] font-normal text-faint">{offer.version}</span>
      </h4>
      <div className="mt-1.5 flex flex-col gap-1 text-[12px] leading-relaxed text-muted">
        {offer.author && <p>作者：{offer.author}</p>}
        {offer.description && <p>{offer.description}</p>}
        {runs && <p>它会：{runs}</p>}
        {network.length > 0 && <p>联网：{network.join("、")}</p>}
        {offer.replacing && <p>会替换已安装的 {offer.replacing}。</p>}
        <p className="text-fg">插件是运行在这台 Mac 上的程序，可以读写你的文件。只安装你信任的插件。</p>
      </div>
      <div className="mt-3 flex justify-end gap-2">
        <Button onClick={onCancel}>取消</Button>
        <Button primary onClick={onInstall}>
          安装
        </Button>
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
