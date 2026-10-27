import { useEffect, useRef, useState } from "react";
import { api, type PluginInfo, type PluginOffer, type PluginSetting } from "../../lib/api";
import { t } from "../../lib/i18n";
import { languageName } from "../../lib/imports";
import { isWindows } from "../../lib/platform";
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
      <h3 className="text-[12px] font-medium text-faint">{t("插件")}</h3>
      <p className="mt-1 text-[12px] leading-relaxed text-muted">
        {isWindows
          ? t("插件给应用加上额外的功能，例如粘贴 YouTube 链接导入音频。插件是运行在这台电脑上的程序，只安装你信任的插件。")
          : t("插件给应用加上额外的功能，例如粘贴 YouTube 链接导入音频。插件是运行在这台 Mac 上的程序，只安装你信任的插件。")}
      </p>
      <div className="mt-1 flex flex-col divide-y divide-line">
        {plugins.map((p) => (
          <PluginRow key={p.id} plugin={p} onChange={setPlugins} />
        ))}
      </div>
      {offer ? (
        <Offer offer={offer} onInstall={() => void install()} onCancel={() => setOffer(null)} />
      ) : (
        <div className="mt-3 flex items-center gap-3">
          <Button onClick={() => void pick()}>{t("从文件夹安装…")}</Button>
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
    <div role="group" aria-label={t("安装插件")} className="mt-3 rounded-[10px] bg-fill px-4 py-3.5">
      <h4 className="flex items-baseline gap-2 text-[13px] font-medium">
        {t("安装插件「{name}」？", { name: offer.name })}
        <span className="tabular font-mono text-[11px] font-normal text-faint">{offer.version}</span>
      </h4>
      <div className="mt-1.5 flex flex-col gap-1 text-[12px] leading-relaxed text-muted">
        {offer.author && <p>{t("作者：{author}", { author: offer.author })}</p>}
        {offer.description && <p>{offer.description}</p>}
        {runs && <p>{t("它会：{runs}", { runs })}</p>}
        {network.length > 0 && <p>{t("联网：{hosts}", { hosts: network.join(t("、")) })}</p>}
        {offer.replacing && <p>{t("会替换已安装的 {name}。", { name: offer.replacing })}</p>}
        <p className="text-fg">
          {isWindows ? t("插件是运行在这台电脑上的程序，可以读写你的文件。只安装你信任的插件。") : t("插件是运行在这台 Mac 上的程序，可以读写你的文件。只安装你信任的插件。")}
        </p>
      </div>
      <div className="mt-3 flex justify-end gap-2">
        <Button onClick={onCancel}>{t("取消")}</Button>
        <Button primary onClick={onInstall}>
          {t("安装")}
        </Button>
      </div>
    </div>
  );
}

function PluginRow({ plugin, onChange }: { plugin: PluginInfo; onChange: (list: PluginInfo[]) => void }) {
  const [confirm, setConfirm] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const remove = async () => {
    try {
      onChange(await api.plugins.remove(plugin.id));
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
          {plugin.importers.length > 0 && <>{t("可以导入：{kinds}", { kinds: plugin.importers.join(t("、")) })} · </>}
          {plugin.readings.length > 0 && (
            <>{t("给这些语言注音：{languages}", { languages: plugin.readings.map((l) => languageName(l, l)).join(t("、")) })} · </>
          )}
          {t("占用")} <span className="tabular font-mono">{plugin.bytes < 1e6 ? t("不到 1 MB") : formatBytes(plugin.bytes)}</span>
        </p>
        {plugin.settings.map((s) => (
          <PluginOption key={s.key} plugin={plugin.id} setting={s} onChange={onChange} onError={setError} />
        ))}
      </div>
      {confirm ? (
        <Button primary onClick={() => void remove()}>
          {t("确定删除")}
        </Button>
      ) : (
        <Button onClick={() => setConfirm(true)}>{t("删除")}</Button>
      )}
    </div>
  );
}

/** One of the plugin's own options (manifest `settings`); its words are the plugin's. */
function PluginOption({ plugin, setting, onChange, onError }: {
  plugin: string;
  setting: PluginSetting;
  onChange: (list: PluginInfo[]) => void;
  onError: (message: string | null) => void;
}) {
  const pick = async (value: string) => {
    try {
      onChange(await api.plugins.setSetting(plugin, setting.key, value));
      onError(null);
    } catch (e) {
      onError(String(e));
    }
  };
  return (
    <div className="mt-2 flex items-center gap-3">
      <span className="text-[12px] text-muted">{setting.label}</span>
      <div className="tint flex h-7 rounded-[8px] p-0.5" role="radiogroup" aria-label={setting.label}>
        {setting.options.map((o) => (
          <button
            key={o.value}
            role="radio"
            aria-checked={setting.value === o.value}
            onClick={() => void pick(o.value)}
            className={`rounded-[6px] px-2.5 text-[12px] font-medium transition-[background-color,color] duration-150 ${
              setting.value === o.value ? "bg-raised text-fg shadow-[inset_0_0_0_1px_var(--line)]" : "text-muted hover:text-fg"
            }`}
          >
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}
