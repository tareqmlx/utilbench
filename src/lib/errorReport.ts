// Anonymous error-report buffer + scrubber + GitHub issue URL builder.
//
// This is a plain singleton module (no React). All catch sites push scrubbed
// errors here; the global Report button reads the latest at click time. Memory
// only — never persisted, so a refresh clears it. Nothing is ever sent; a URL
// is only opened on an explicit user click.
//
// Because GitHub repos/issues are PUBLIC, everything that can reach buildIssueUrl
// must be strictly anonymous: no user input, no tool output, no query strings,
// no IP/cookies/localStorage/fingerprint, no full user-agent, no language.

import { getToolBySlug } from "@/tools/registry";

const REPO = "tareqmlx/utilbench";
const BUFFER_CAP = 5;
const MESSAGE_MAX = 300;
const MAX_URL_LENGTH = 6000;

export interface ScrubbedError {
  name: string;
  message: string;
  stack: string;
  source: string;
  at: string;
}

export interface ReportEnv {
  version: string;
  path: string;
  browser: string;
  viewport: string;
  time: string;
}

const buffer: ScrubbedError[] = [];

// Error.name is mutable (`err.name = "<anything>"`) and could carry input, so it
// is normalized to this allowlist before it can reach the public issue title.
const KNOWN_ERROR_NAMES = new Set([
  "Error",
  "EvalError",
  "RangeError",
  "ReferenceError",
  "SyntaxError",
  "TypeError",
  "URIError",
  "AggregateError",
  "DOMException",
  "AbortError",
  "TimeoutError",
  "NotFoundError",
  "SecurityError",
  "QuotaExceededError",
]);

function safeName(name: string): string {
  return KNOWN_ERROR_NAMES.has(name) ? name : "Error";
}

/** Defense-in-depth redaction. Runs on every message + stack before anything
 * can reach a public URL. */
export function scrub(text: string): string {
  if (!text) return "";
  let out = text;
  // Drop blob:/data: URLs entirely — they can embed file contents.
  out = out.replace(/\b(?:blob|data):[^\s)'"]+/gi, "[redacted-url]");
  // Redact http(s) URLs. A URL path segment can itself be private data, so only
  // a safe code filename (the useful part of a stack frame, optionally with
  // :line:col) survives — everything else becomes [redacted-url].
  out = out.replace(/https?:\/\/[^\s)'"]+/gi, (url) => {
    const base = url.split(/[?#]/)[0] ?? url;
    const seg = base.split("/").filter(Boolean).pop() ?? "";
    const m = seg.match(/^([\w.-]+\.(?:js|mjs|cjs|ts|tsx|jsx))(:\d+:\d+)?$/);
    return m ? `${m[1]}${m[2] ?? ""}` : "[redacted-url]";
  });
  // PII-shaped tokens. JWT before base64 (a JWT looks base64-ish in parts).
  out = out.replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, "[redacted]");
  out = out.replace(/eyJ[\w-]+\.[\w-]+\.[\w-]+/g, "[redacted]");
  out = out.replace(/[A-Za-z0-9+/]{20,}={0,2}/g, "[redacted]");
  out = out.replace(/\b[0-9a-fA-F]{16,}\b/g, "[redacted]");
  return out;
}

/** Keep only `at …` frames, trimmed, with URLs/tokens scrubbed. Arg values are
 * not present in V8 stacks; this just normalizes file references to basenames. */
function collapseStack(stack: string): string {
  return stack
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.startsWith("at "))
    .map((line) => scrub(line))
    .join("\n");
}

function normalize(error: unknown, source: string, at: string): ScrubbedError {
  if (error instanceof Error) {
    return {
      name: safeName(error.name || "Error"),
      message: scrub(error.message).slice(0, MESSAGE_MAX),
      stack: collapseStack(error.stack ?? ""),
      source,
      at,
    };
  }
  if (typeof error === "string") {
    return { name: "Error", message: scrub(error).slice(0, MESSAGE_MAX), stack: "", source, at };
  }
  // Unknown reason (e.g. a rejected non-Error). Stringify defensively.
  let message = "Unknown error";
  try {
    message = scrub(typeof error === "object" ? JSON.stringify(error) : String(error)).slice(
      0,
      MESSAGE_MAX,
    );
  } catch {
    /* keep fallback */
  }
  return { name: "Error", message, stack: "", source, at };
}

export function pushError(error: unknown, ctx?: { source: string }): ScrubbedError {
  const at = new Date().toISOString();
  const scrubbed = normalize(error, ctx?.source ?? "unknown", at);
  buffer.push(scrubbed);
  while (buffer.length > BUFFER_CAP) buffer.shift();
  return scrubbed;
}

export function latestError(): ScrubbedError | null {
  return buffer[buffer.length - 1] ?? null;
}

// Minimal local typing for UA-Client-Hints (not in lib.dom, absent in jsdom).
interface UADataBrand {
  brand: string;
  version: string;
}
interface NavigatorUAData {
  brands?: UADataBrand[];
  platform?: string;
}

function coarseBrowser(): string {
  const uaData = (navigator as Navigator & { userAgentData?: NavigatorUAData }).userAgentData;
  if (uaData?.brands?.length) {
    // Prefer a named brand over the generic "Chromium"/"Not_A Brand" entries.
    const brand = uaData.brands.find((b) => !/not|chromium/i.test(b.brand)) ?? uaData.brands[0];
    const name = brand?.brand ?? "Unknown";
    const version = brand?.version ?? "";
    const os = uaData.platform ? ` / ${uaData.platform}` : "";
    return `${name}${version ? ` ${version}` : ""}${os}`;
  }
  // Fallback: coarse UA-string family match only (never the full UA).
  const ua = navigator.userAgent || "";
  let family = "Unknown";
  if (/firefox/i.test(ua)) family = "Firefox";
  else if (/edg/i.test(ua)) family = "Edge";
  else if (/chrome|chromium/i.test(ua)) family = "Chrome";
  else if (/safari/i.test(ua)) family = "Safari";
  let os = "";
  if (/windows/i.test(ua)) os = " / Windows";
  else if (/mac os|macintosh/i.test(ua)) os = " / macOS";
  else if (/android/i.test(ua)) os = " / Android";
  else if (/iphone|ipad|ios/i.test(ua)) os = " / iOS";
  else if (/linux/i.test(ua)) os = " / Linux";
  return `${family}${os}`;
}

// Coarse viewport bucket only — exact px + DPR add fingerprint entropy, which
// conflicts with the "no device fingerprints" promise. A Tailwind breakpoint
// name + retina flag keeps responsive-bug signal without the entropy.
function viewportBucket(): string {
  if (typeof innerWidth !== "number") return "unknown";
  const w = innerWidth;
  const bp =
    w < 640 ? "xs" : w < 768 ? "sm" : w < 1024 ? "md" : w < 1280 ? "lg" : w < 1536 ? "xl" : "2xl";
  const retina = typeof devicePixelRatio === "number" && devicePixelRatio >= 2 ? " retina" : "";
  return `${bp}${retina}`;
}

// A 404/catch-all or arbitrary :toolSlug means location.pathname can be free
// text (e.g. /customer/acme-secret). Normalize to known routes only; redact the
// rest so arbitrary path text never reaches the public issue.
function normalizePath(pathname: string): string {
  if (pathname === "/" || pathname === "/tools" || pathname === "/privacy") return pathname;
  const m = pathname.match(/^\/tools\/([^/]+)$/);
  if (m) {
    const slug = m[1] ?? "";
    return getToolBySlug(slug) ? `/tools/${slug}` : "/tools/(unknown)";
  }
  return "/(other)";
}

export function collectEnv(): ReportEnv {
  const version = typeof __APP_VERSION__ !== "undefined" ? __APP_VERSION__ : "dev";
  // pathname only — strip search + hash (useUrlState tools put input in ?query=),
  // then normalize so only known route/tool labels can be reported.
  const path = typeof location !== "undefined" ? normalizePath(location.pathname) : "/";
  return {
    version,
    path,
    browser: coarseBrowser(),
    viewport: viewportBucket(),
    time: new Date().toISOString(),
  };
}

function renderBody(env: ReportEnv, error: ScrubbedError | null): string {
  const debug = [
    `- App: utilbench v${env.version}`,
    `- Page: ${env.path}`,
    `- Browser: ${env.browser}`,
    `- Viewport: ${env.viewport}`,
    `- Time: ${env.time}`,
  ];
  if (error) {
    // Category only. The free-form message can echo user input, and a prefilled
    // ?body reaches GitHub's servers on click (not gated by the user's review),
    // so it must never enter the URL — it stays in the in-memory buffer only.
    debug.push(`- Error: ${safeName(error.name)}`);
    if (error.stack) {
      debug.push("- Stack:");
      debug.push("```");
      debug.push(error.stack);
      debug.push("```");
    }
  }
  return [
    "**What happened?**",
    "<!-- describe the bug -->",
    "",
    "**Steps to reproduce**",
    "1. ",
    "",
    "<details><summary>Debug info (anonymous, auto-filled)</summary>",
    "",
    ...debug,
    "",
    "</details>",
  ].join("\n");
}

// The `?title&body&labels` prefill opens GitHub's plain markdown editor,
// coexisting with the ISSUE_TEMPLATE form. This relies on blank issues being
// enabled (the default). Disabling them later would silently break this prefill.
function makeUrl(title: string, body: string): string {
  const params = new URLSearchParams({ labels: "bug", title, body });
  return `https://github.com/${REPO}/issues/new?${params.toString()}`;
}

function withStack(error: ScrubbedError | null, stackLines: string[]): ScrubbedError | null {
  return error ? { ...error, stack: stackLines.join("\n") } : null;
}

export function buildIssueUrl(opts?: { error?: ScrubbedError | null }): string {
  const env = collectEnv();
  const error = opts?.error ?? null;
  // Title is public + search-indexed — use the allowlisted error category only,
  // never the free-form message (which can echo user input). safeName is applied
  // again here as defense-in-depth, independent of how the error was built.
  const title = error ? `[bug] ${safeName(error.name)}`.slice(0, 120) : "[bug] ";

  // The cap is on the ENCODED URL (URLSearchParams already encodes). Drop whole
  // stack frames — never slice mid-body — so the rendered markdown stays valid.
  let stackLines = error?.stack ? error.stack.split("\n") : [];
  let url = makeUrl(title, renderBody(env, withStack(error, stackLines)));
  while (url.length > MAX_URL_LENGTH && stackLines.length > 0) {
    const drop = Math.max(1, Math.ceil(stackLines.length * 0.2));
    stackLines = stackLines.slice(0, stackLines.length - drop);
    url = makeUrl(title, renderBody(env, withStack(error, stackLines)));
  }
  return url;
}
