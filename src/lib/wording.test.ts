import { afterEach, describe, expect, it } from "vitest";
import { setLang } from "./i18n";
import { device, savedInVault, vault } from "./wording";

afterEach(() => setLang("zh"));

describe("wording that depends on the system", () => {
  it("says Mac or the computer, Keychain or Credential Manager, in Chinese", () => {
    expect(device(false)).toBe("这台 Mac");
    expect(device(true)).toBe("这台电脑");
    expect(vault(false)).toBe("macOS 钥匙串");
    expect(vault(true)).toBe("Windows 凭据管理器");
    expect(savedInVault(false)).toBe("已保存在钥匙串");
    expect(savedInVault(true)).toBe("已保存在凭据管理器");
  });

  it("and in English", () => {
    setLang("en");
    expect(device(false)).toBe("this Mac");
    expect(device(true)).toBe("this PC");
    expect(vault(false)).toBe("macOS Keychain");
    expect(vault(true)).toBe("Windows Credential Manager");
    expect(savedInVault(false)).toBe("Saved in Keychain");
    expect(savedInVault(true)).toBe("Saved in Credential Manager");
  });
});
