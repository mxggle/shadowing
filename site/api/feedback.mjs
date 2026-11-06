// POST /api/feedback (a Vercel Node.js function): the app's 意见反馈 window and its check-in cards send
// what the learner wrote, from Rust (src-tauri/src/feedback.rs); this checks it and files it as an
// issue in a private GitHub repository. Nothing is kept here: the client IP lives only in this
// instance's rate-limit map, and the logs carry outcomes and status codes, never what was written.
// The pure helpers are exported for scripts/feedback-api.test.mjs.

const MAX_JSON = 16 * 1024; // length of the JSON text (UTF-16 units), so 4000 emoji still fit
const MAX_MESSAGE = 4000;
const MAX_CONTACT = 200;
const MAX_SHORT = 40;
const MAX_ENTRIES = 20;
const MAX_VALUE = 200;
const TITLE_LENGTH = 60;
const DEFAULT_REPO = "mxggle/shadowing-feedback";

const KIND = /^[a-z0-9-]{1,32}$/;
const OS = /^[a-z0-9-]{1,40}$/;
const LANG = /^[A-Za-z0-9-]{1,40}$/;
const KEY = /^[a-zA-Z][a-zA-Z0-9]{0,31}$/;
const REPO = /^[\w.-]+\/[\w.-]+$/;

// Maps, not object literals: a kind or key like "constructor" must not find Object.prototype's.
const PREFIX = new Map([["feedback", "反馈"], ["card-3days", "三天卡片"]]);
const OS_NAME = new Map([["macos", "macOS"], ["windows", "Windows"]]);
const LANG_NAME = new Map([["zh", "中文"], ["en", "English"]]);
// The app's diagnostics, labelled as its window labels them; unknown keys show as sent.
const LABEL = new Map([
  ["os", "系统"], ["chip", "芯片"], ["memory", "内存"], ["transcribe", "转写"],
  ["chat", "句子解释"], ["plugins", "插件"], ["studyLanguage", "学习的语言"],
]);

const INVALID = { ok: false, status: 400, error: "invalid" };
const TOO_LARGE = { ok: false, status: 413, error: "too-large" };

/** Length in code points, as Rust's chars().count(): an emoji or a kanji is one. */
const length = (s) => [...s].length;

const isObject = (v) => typeof v === "object" && v !== null && !Array.isArray(v);

/** `v` trimmed when it is a string of min..max code points, else null. */
function text(v, max, min = 1) {
  if (typeof v !== "string") return null;
  const s = v.trim();
  const n = length(s);
  return n >= min && n <= max ? s : null;
}

/** `v` when it is a string matching `re`, else null. */
const slug = (v, re) => (typeof v === "string" && re.test(v) ? v : null);

/**
 * Checks a request body: Vercel's parsed JSON, or the raw text (a string or Buffer).
 * Returns { ok: true, value } with strings trimmed and absent parts left out,
 * or { ok: false, status, error } to answer with.
 */
export function parse(body) {
  let data = body;
  if (typeof body === "string" || Buffer.isBuffer(body)) {
    const json = body.toString();
    if (json.length > MAX_JSON) return TOO_LARGE;
    try {
      data = JSON.parse(json);
    } catch {
      return INVALID;
    }
  } else if (isObject(body)) {
    if (JSON.stringify(body).length > MAX_JSON) return TOO_LARGE;
  } else {
    return INVALID;
  }
  if (!isObject(data)) return INVALID;

  const kind = slug(data.kind, KIND);
  const message = text(data.message, MAX_MESSAGE);
  const contact = data.contact == null ? "" : text(data.contact, MAX_CONTACT, 0);
  const app = isObject(data.app)
    ? { version: text(data.app.version, MAX_SHORT), os: slug(data.app.os, OS), lang: slug(data.app.lang, LANG) }
    : null;
  const diagnostics = entries(data.diagnostics);
  if (!kind || !message || contact === null || !app?.version || !app.os || !app.lang || !diagnostics) {
    return INVALID;
  }
  const value = { kind, message, app };
  if (contact) value.contact = contact;
  if (diagnostics.length) value.diagnostics = Object.fromEntries(diagnostics);
  return { ok: true, value };
}

/** The diagnostics as [key, value] pairs (none when absent), or null when malformed. */
function entries(v) {
  if (v == null) return [];
  if (!isObject(v)) return null;
  const pairs = Object.entries(v);
  if (pairs.length > MAX_ENTRIES) return null;
  const out = [];
  for (const [key, raw] of pairs) {
    const value = text(raw, MAX_VALUE, 0);
    if (!KEY.test(key) || value === null) return null;
    out.push([key, value]);
  }
  return out;
}

/**
 * Makes user text inert on GitHub: no HTML, and no @-mention that could ping anyone. An @ that
 * follows a letter or digit (an email address) never mentions anyone, so it is left as it is and
 * the address still copies cleanly.
 */
export function sanitize(s) {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/(^|[^A-Za-z0-9])@/g, "$1@\u200B");
}

/** One line of user text (the contact). */
const inline = (s) => sanitize(s).replace(/\s+/g, " ").trim();

/** A table cell: one line, with \ and | escaped so it can't end the cell or add a column. */
const cell = (s) => inline(s).replace(/[\\|]/g, "\\$&");

const table = (rows) =>
  ["| 项目 | 内容 |", "| --- | --- |", ...rows.map(([k, v]) => `| ${cell(k)} | ${cell(v)} |`)].join("\n");

/** "[反馈] …": the message's first non-empty line on one line, cut to 60 code points. Titles are
 * plain text on GitHub (no HTML, no mentions), so nothing is escaped. */
function titleOf(kind, message) {
  const line = message.split(/\r\n|\r|\n/).map((l) => l.replace(/\s+/g, " ").trim()).find(Boolean) ?? "";
  const chars = [...line];
  const short = chars.length > TITLE_LENGTH ? `${chars.slice(0, TITLE_LENGTH).join("")}…` : line;
  return `[${PREFIX.get(kind) ?? kind}] ${short}`;
}

/** The issue for a parsed submission: { title, body, labels }. */
export function issueFrom({ kind, message, contact, app, diagnostics }) {
  const parts = [
    sanitize(message),
    `**联系方式**：${contact ? inline(contact) : "未填写"}`,
    table([
      ["应用版本", app.version],
      ["系统", OS_NAME.get(app.os) ?? app.os],
      ["界面语言", LANG_NAME.get(app.lang) ?? app.lang],
    ]),
  ];
  if (diagnostics) {
    const rows = Object.entries(diagnostics).map(([k, v]) => [LABEL.get(k) ?? k, v]);
    parts.push(`<details><summary>诊断信息</summary>\n\n${table(rows)}\n\n</details>`);
  }
  return { title: titleOf(kind, message), body: parts.join("\n\n"), labels: [kind, `app:${app.os}`] };
}

/**
 * A best-effort rate limit for one function instance: `hit(key)` allows at most `max` hits per key
 * in any `windowMs`, else says how many seconds to wait. The map keeps keys in the order of their
 * last allowed hit, so stale ones are at the front and go first; it never holds more than `maxKeys`.
 */
export function createLimiter({ max = 5, windowMs = 10 * 60 * 1000, now = Date.now, maxKeys = 10_000 } = {}) {
  const hits = new Map(); // key → times of allowed hits inside the window, oldest first
  return {
    hit(key) {
      const t = now();
      const recent = (hits.get(key) ?? []).filter((at) => t - at < windowMs);
      if (recent.length >= max) {
        hits.set(key, recent); // keeps its place: only allowed hits move a key to the back
        return { ok: false, retryAfter: Math.max(1, Math.ceil((recent[0] + windowMs - t) / 1000)) };
      }
      recent.push(t);
      hits.delete(key);
      hits.set(key, recent);
      for (const [k, times] of hits) {
        if (t - times[times.length - 1] < windowMs && hits.size <= maxKeys) break;
        hits.delete(k);
      }
      return { ok: true };
    },
    get size() {
      return hits.size;
    },
  };
}

const limiter = createLimiter();

/** The client's address, used only as the rate-limit key. */
function clientIp(req) {
  const header = (name) => {
    const v = req.headers?.[name];
    return (Array.isArray(v) ? v[0] : v)?.split(",")[0].trim();
  };
  return header("x-forwarded-for") || header("x-real-ip") || req.socket?.remoteAddress || "unknown";
}

/** req.body, or undefined when Vercel's lazy JSON parser throws on a malformed body. */
function bodyOf(req) {
  try {
    return req.body;
  } catch {
    return undefined;
  }
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "method" });
  }
  // Only the app sends here, from Rust, which sends no Origin; a web page can't make visitors post.
  if (req.headers?.origin) return res.status(403).json({ error: "forbidden" });
  const parsed = parse(bodyOf(req));
  if (!parsed.ok) return res.status(parsed.status).json({ error: parsed.error });

  const token = process.env.FEEDBACK_GITHUB_TOKEN?.trim();
  const repo = process.env.FEEDBACK_REPO?.trim() || DEFAULT_REPO;
  if (!token || !REPO.test(repo)) {
    console.error("feedback: FEEDBACK_GITHUB_TOKEN or FEEDBACK_REPO is not set up");
    return res.status(503).json({ error: "unconfigured" });
  }
  const allowed = limiter.hit(clientIp(req));
  if (!allowed.ok) {
    res.setHeader("Retry-After", String(allowed.retryAfter));
    return res.status(429).json({ error: "rate" });
  }

  const issue = issueFrom(parsed.value);
  const file = (body) =>
    fetch(`https://api.github.com/repos/${repo}/issues`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": "shadowing-feedback",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(10_000),
    });
  let answer;
  try {
    answer = await file(issue);
    // 422 is GitHub refusing the content, most likely a label it won't create for this token:
    // the feedback matters more than its labels.
    if (answer.status === 422) {
      console.error("feedback: GitHub answered 422, filing without labels");
      answer = await file({ ...issue, labels: [] });
    }
  } catch (e) {
    console.error(`feedback: GitHub unreachable (${e?.name ?? "error"})`);
    return res.status(502).json({ error: "upstream" });
  }
  if (!answer.ok) {
    console.error(`feedback: GitHub answered ${answer.status}`);
    return res.status(502).json({ error: "upstream" });
  }
  console.log(`feedback: filed (${answer.status})`);
  return res.status(200).json({ ok: true });
}
