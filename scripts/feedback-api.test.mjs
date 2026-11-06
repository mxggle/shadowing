import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import handler, { createLimiter, issueFrom, parse, sanitize } from "../site/api/feedback.mjs";

const ZWSP = "​";

const valid = () => ({
  kind: "feedback",
  message: "  录音没声音\n第二行  ",
  contact: " me@example.com ",
  app: { version: "0.18.0", os: "macos", lang: "zh" },
  diagnostics: { os: "macOS 15.1 (aarch64)", chip: "Apple M2", memory: "16 GB", plugins: "youtube 1.2.0" },
});

const changed = (patch) => ({ ...valid(), ...patch });
const app = (patch) => changed({ app: { ...valid().app, ...patch } });

describe("parse", () => {
  it("passes a valid body, trimmed", () => {
    expect(parse(valid())).toEqual({
      ok: true,
      value: {
        kind: "feedback",
        message: "录音没声音\n第二行",
        contact: "me@example.com",
        app: { version: "0.18.0", os: "macos", lang: "zh" },
        diagnostics: { os: "macOS 15.1 (aarch64)", chip: "Apple M2", memory: "16 GB", plugins: "youtube 1.2.0" },
      },
    });
  });

  it("reads raw JSON text too, and leaves out what was not given", () => {
    const body = { kind: "card-3days", message: "好用", contact: "  ", app: valid().app, diagnostics: {} };
    const want = { ok: true, value: { kind: "card-3days", message: "好用", app: valid().app } };
    expect(parse(JSON.stringify(body))).toEqual(want);
    expect(parse(Buffer.from(JSON.stringify(body)))).toEqual(want);
    expect(parse({ ...body, contact: null, diagnostics: null })).toEqual(want);
  });

  it.each([
    ["no body", undefined],
    ["not JSON", "{kind:"],
    ["an array", [valid()]],
    ["JSON that is not an object", '"hi"'],
    ["no kind", changed({ kind: undefined })],
    ["an upper-case kind", changed({ kind: "Feedback" })],
    ["a long kind", changed({ kind: "a".repeat(33) })],
    ["a kind with spaces", changed({ kind: "feed back" })],
    ["no message", changed({ message: undefined })],
    ["a blank message", changed({ message: " \n\t " })],
    ["a message that is not a string", changed({ message: 42 })],
    ["a long contact", changed({ contact: "a".repeat(201) })],
    ["a contact that is not a string", changed({ contact: { email: "x" } })],
    ["no app", changed({ app: undefined })],
    ["app as a string", changed({ app: "0.18.0" })],
    ["no version", app({ version: "" })],
    ["a long version", app({ version: "1".repeat(41) })],
    ["an os with capitals", app({ os: "macOS" })],
    ["no os", app({ os: undefined })],
    ["a long lang", app({ lang: "z".repeat(41) })],
    ["a lang with spaces", app({ lang: "zh cn" })],
    ["diagnostics as a list", changed({ diagnostics: ["Apple M2"] })],
    ["a diagnostic that is not a string", changed({ diagnostics: { memory: 16 } })],
    ["a long diagnostic", changed({ diagnostics: { chip: "x".repeat(201) } })],
    ["a diagnostic key with a dash", changed({ diagnostics: { "study-language": "ja" } })],
    ["a diagnostic key starting with a digit", changed({ diagnostics: { "1os": "x" } })],
    ["a long diagnostic key", changed({ diagnostics: { ["k".repeat(33)]: "x" } })],
    ["21 diagnostics", changed({ diagnostics: Object.fromEntries([...Array(21)].map((_, i) => [`k${i}`, "x"])) })],
  ])("rejects %s", (_, body) => {
    expect(parse(body)).toEqual({ ok: false, status: 400, error: "invalid" });
  });

  it("rejects a body over 16 KB", () => {
    const big = changed({ message: "a".repeat(17_000) });
    expect(parse(big)).toEqual({ ok: false, status: 413, error: "too-large" });
    expect(parse(JSON.stringify(big))).toEqual({ ok: false, status: 413, error: "too-large" });
  });

  it("counts code points, not UTF-16 units", () => {
    // 4000 emoji are 8000 UTF-16 units and 16000 UTF-8 bytes; with diagnostics they still fit.
    expect(parse(changed({ message: "😀".repeat(4000) })).ok).toBe(true);
    expect(parse(changed({ message: "😀".repeat(4001) }))).toMatchObject({ status: 400 });
    expect(parse(changed({ contact: "字".repeat(200) })).ok).toBe(true);
    expect(parse(changed({ contact: "字".repeat(201) })).ok).toBe(false);
  });
});

describe("issue", () => {
  const issue = (patch) => issueFrom(parse(changed(patch)).value);

  it("sanitize escapes HTML and breaks mentions, not email addresses", () => {
    expect(sanitize('<img src=x onerror="alert(1)"> & @octocat (@org/team)')).toBe(
      `&lt;img src=x onerror="alert(1)"&gt; &amp; @${ZWSP}octocat (@${ZWSP}org/team)`,
    );
    expect(sanitize("@me\n@you me@example.com")).toBe(`@${ZWSP}me\n@${ZWSP}you me@example.com`);
    const { body } = issue({ message: "@octocat <script>x</script>", contact: "@octocat" });
    expect(body).not.toMatch(/(^|[^A-Za-z0-9])@(?!\u200B)/m);
    expect(body).not.toContain("<script>");
    expect(issue({}).body).toContain("me@example.com");
  });

  it("keeps the title as written: GitHub shows titles as plain text", () => {
    expect(issue({ message: "Tom & Jerry <3 @octocat" }).title).toBe("[反馈] Tom & Jerry <3 @octocat");
  });

  it("titles by kind, from the first non-empty line", () => {
    expect(issue({ message: "  \n\n  第一行   有\t空格 \n第二行" }).title).toBe("[反馈] 第一行 有 空格");
    expect(issue({ kind: "card-3days", message: "好用" }).title).toBe("[三天卡片] 好用");
    expect(issue({ kind: "bug", message: "x" }).title).toBe("[bug] x");
    expect(issue({ kind: "constructor", message: "x" }).title).toBe("[constructor] x");
  });

  it("cuts the title to 60 code points", () => {
    expect(issue({ message: "字".repeat(60) }).title).toBe(`[反馈] ${"字".repeat(60)}`);
    expect(issue({ message: "字".repeat(61) }).title).toBe(`[反馈] ${"字".repeat(60)}…`);
    expect(issue({ message: "😀".repeat(70) }).title).toBe(`[反馈] ${"😀".repeat(60)}…`);
  });

  it("labels by kind and system", () => {
    expect(issue({}).labels).toEqual(["feedback", "app:macos"]);
    expect(issue({ kind: "card-3days", app: { ...valid().app, os: "windows" } }).labels).toEqual(["card-3days", "app:windows"]);
  });

  it("writes the message, the contact and the app", () => {
    const { body } = issue({});
    expect(body.startsWith("录音没声音\n第二行\n\n")).toBe(true);
    expect(body).toContain("**联系方式**：me@example.com");
    expect(body).toContain("| 应用版本 | 0.18.0 |");
    expect(body).toContain("| 系统 | macOS |");
    expect(body).toContain("| 界面语言 | 中文 |");
    expect(issue({ contact: undefined }).body).toContain("**联系方式**：未填写");
    const other = issue({ app: { version: "1", os: "linux", lang: "en" } }).body;
    expect(other).toContain("| 系统 | linux |");
    expect(other).toContain("| 界面语言 | English |");
  });

  it("puts the diagnostics in a folded table, escaped", () => {
    const { body } = issue({ diagnostics: { plugins: "a | b\nc", chip: "M2 <x>", extraThing: "back\\slash" } });
    expect(body).toContain("<details><summary>诊断信息</summary>\n\n| 项目 | 内容 |\n| --- | --- |\n");
    expect(body).toContain("| 插件 | a \\| b c |");
    expect(body).toContain("| 芯片 | M2 &lt;x&gt; |");
    expect(body).toContain("| extraThing | back\\\\slash |");
    expect(body.endsWith("\n\n</details>")).toBe(true);
    expect(issue({ diagnostics: undefined }).body).not.toContain("<details>");
  });
});

describe("createLimiter", () => {
  it("allows 5 per window per key, then says how long to wait", () => {
    let t = 1_000_000;
    const limiter = createLimiter({ max: 5, windowMs: 600_000, now: () => t });
    for (let i = 0; i < 5; i++) expect(limiter.hit("a").ok).toBe(true);
    expect(limiter.hit("a")).toEqual({ ok: false, retryAfter: 600 });
    expect(limiter.hit("b").ok).toBe(true);
    t += 599_000;
    expect(limiter.hit("a")).toEqual({ ok: false, retryAfter: 1 });
    t += 1_000;
    expect(limiter.hit("a").ok).toBe(true);
  });

  it("forgets stale keys and never holds too many", () => {
    let t = 0;
    const limiter = createLimiter({ windowMs: 1_000, now: () => t, maxKeys: 3 });
    for (const key of ["a", "b", "c", "d", "e"]) limiter.hit(key);
    expect(limiter.size).toBe(3);
    t += 1_000;
    limiter.hit("f");
    expect(limiter.size).toBe(1);
  });
});

describe("handler", () => {
  let ip = 0;
  const request = (body = valid(), { method = "POST", from = `203.0.113.${++ip}` } = {}) => ({
    method,
    headers: { "content-type": "application/json", "x-forwarded-for": `${from}, 10.0.0.1` },
    body,
  });
  const reply = () => {
    const res = { statusCode: 200, headers: {}, body: undefined };
    res.status = (n) => ((res.statusCode = n), res);
    res.json = (obj) => ((res.body = obj), res);
    res.setHeader = (k, v) => ((res.headers[k.toLowerCase()] = v), res);
    return res;
  };
  const send = async (req) => {
    const res = reply();
    await handler(req, res);
    return res;
  };
  const github = (status = 201) => vi.fn(async () => new Response("{}", { status }));
  let logged;

  beforeEach(() => {
    vi.stubEnv("FEEDBACK_GITHUB_TOKEN", "github_pat_test");
    vi.stubEnv("FEEDBACK_REPO", "");
    logged = [];
    for (const level of ["log", "info", "warn", "error", "debug"]) {
      vi.spyOn(console, level).mockImplementation((...args) => logged.push(args.map(String).join(" ")));
    }
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("only takes POST", async () => {
    const fetch = github();
    vi.stubGlobal("fetch", fetch);
    const res = await send(request(undefined, { method: "GET" }));
    expect(res.statusCode).toBe(405);
    expect(res.headers.allow).toBe("POST");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("answers 400 and 413 before calling GitHub", async () => {
    const fetch = github();
    vi.stubGlobal("fetch", fetch);
    expect((await send(request(changed({ kind: "" })))).body).toEqual({ error: "invalid" });
    expect((await send(request(changed({ message: "a".repeat(20_000) })))).statusCode).toBe(413);
    const malformed = request();
    Object.defineProperty(malformed, "body", { get: () => { throw new SyntaxError("Invalid JSON"); } });
    expect((await send(malformed)).statusCode).toBe(400);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("answers 503 without a token", async () => {
    vi.stubEnv("FEEDBACK_GITHUB_TOKEN", "");
    const fetch = github();
    vi.stubGlobal("fetch", fetch);
    const res = await send(request());
    expect(res.statusCode).toBe(503);
    expect(res.body).toEqual({ error: "unconfigured" });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("files the issue on GitHub", async () => {
    const fetch = github();
    vi.stubGlobal("fetch", fetch);
    const res = await send(request());
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ ok: true });
    expect(fetch).toHaveBeenCalledTimes(1);
    const [url, init] = fetch.mock.calls[0];
    expect(url).toBe("https://api.github.com/repos/mxggle/shadowing-feedback/issues");
    expect(init.method).toBe("POST");
    expect(init.headers).toEqual({
      Authorization: "Bearer github_pat_test",
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "shadowing-feedback",
      "Content-Type": "application/json",
    });
    expect(init.signal).toBeInstanceOf(AbortSignal);
    expect(JSON.parse(init.body)).toEqual(issueFrom(parse(valid()).value));
    expect(JSON.parse(init.body)).toMatchObject({ title: "[反馈] 录音没声音", labels: ["feedback", "app:macos"] });
  });

  it("uses FEEDBACK_REPO when set", async () => {
    vi.stubEnv("FEEDBACK_REPO", "someone/elsewhere");
    const fetch = github();
    vi.stubGlobal("fetch", fetch);
    await send(request());
    expect(fetch.mock.calls[0][0]).toBe("https://api.github.com/repos/someone/elsewhere/issues");
  });

  it("refuses requests from web pages", async () => {
    const fetch = github();
    vi.stubGlobal("fetch", fetch);
    const req = request();
    req.headers.origin = "https://example.com";
    expect(await send(req)).toMatchObject({ statusCode: 403, body: { error: "forbidden" } });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("files without labels when GitHub refuses them", async () => {
    const fetch = vi.fn(async (_url, init) => new Response("{}", { status: JSON.parse(init.body).labels.length ? 422 : 201 }));
    vi.stubGlobal("fetch", fetch);
    expect(await send(request())).toMatchObject({ statusCode: 200, body: { ok: true } });
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(JSON.parse(fetch.mock.calls[1][1].body)).toMatchObject({ title: "[反馈] 录音没声音", labels: [] });
  });

  it("answers 502 when GitHub fails", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Promise.reject(new TypeError("fetch failed"))));
    expect(await send(request())).toMatchObject({ statusCode: 502, body: { error: "upstream" } });
    vi.stubGlobal("fetch", github(422));
    expect(await send(request())).toMatchObject({ statusCode: 502, body: { error: "upstream" } });
    expect(logged.some((line) => line.includes("422"))).toBe(true);
    vi.stubGlobal("fetch", github(401));
    expect(await send(request())).toMatchObject({ statusCode: 502, body: { error: "upstream" } });
  });

  it("answers 429 after 5 from one address", async () => {
    vi.stubGlobal("fetch", github());
    const from = "198.51.100.7";
    for (let i = 0; i < 5; i++) expect((await send(request(valid(), { from }))).statusCode).toBe(200);
    const res = await send(request(valid(), { from }));
    expect(res.statusCode).toBe(429);
    expect(res.body).toEqual({ error: "rate" });
    expect(Number(res.headers["retry-after"])).toBeGreaterThan(0);
    expect(Number(res.headers["retry-after"])).toBeLessThanOrEqual(600);
    expect((await send(request(valid()))).statusCode).toBe(200);
  });

  it("never logs what was written, or the address", async () => {
    const body = changed({
      message: "秘密的内容 secret-message",
      contact: "secret@example.com",
      diagnostics: { chip: "SecretChip" },
    });
    const from = "192.0.2.99";
    vi.stubGlobal("fetch", github());
    await send(request(body, { from }));
    vi.stubGlobal("fetch", github(500));
    await send(request(body, { from }));
    vi.stubGlobal("fetch", vi.fn(async () => Promise.reject(new Error("secret-message"))));
    await send(request(body, { from }));
    vi.stubEnv("FEEDBACK_GITHUB_TOKEN", "");
    await send(request(body, { from }));
    expect(logged.length).toBeGreaterThan(0);
    for (const secret of ["秘密", "secret-message", "secret@", "SecretChip", from, "github_pat_test"]) {
      expect(logged.join("\n")).not.toContain(secret);
    }
  });
});
