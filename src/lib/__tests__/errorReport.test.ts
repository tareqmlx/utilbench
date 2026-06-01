import { describe, expect, it } from "vitest";
import { buildIssueUrl, collectEnv, latestError, pushError, scrub } from "../errorReport";

describe("scrub", () => {
  it("redacts emails", () => {
    expect(scrub("contact me at jane.doe@example.com please")).not.toContain("jane.doe");
    expect(scrub("jane@example.com")).toContain("[redacted]");
  });

  it("redacts long base64, hex, and JWT tokens", () => {
    expect(scrub("token QUJDREVGR0hJSktMTU5PUFFSU1Q=")).toContain("[redacted]");
    expect(scrub("hash deadbeefdeadbeefcafe")).toContain("[redacted]");
    expect(scrub("jwt eyJhbGciOi.eyJzdWIiOi.SflKxwRJ")).toContain("[redacted]");
  });

  it("strips query strings, blob:, and data: URLs from stack-like text", () => {
    const out = scrub("at fn (https://site.com/src/Route.tsx?secret=abc:42:11)");
    expect(out).not.toContain("?secret=abc");
    expect(out).not.toContain("https://");
    expect(scrub("blob:https://x/uuid-here")).not.toContain("blob:");
    expect(scrub("data:text/plain;base64,SGVsbG8=")).not.toContain("data:");
  });

  it("redacts arbitrary URL path segments but keeps safe code filenames", () => {
    // A path segment can itself be private — must not survive.
    expect(scrub("Failed to load https://internal.acme.com/secret-project?token=x")).toContain(
      "[redacted-url]",
    );
    expect(scrub("https://internal.acme.com/secret-project")).not.toContain("secret-project");
    // A stack-frame code file is the useful part and is safe to keep.
    expect(scrub("at o (https://utilbench.dev/assets/index-AbC123.js:1:2345)")).toContain(
      "index-AbC123.js:1:2345",
    );
  });
});

describe("collectEnv", () => {
  it("path never contains a query string or hash", () => {
    window.history.replaceState({}, "", "/tools/base64-encoder?query=SECRET#frag");
    const env = collectEnv();
    expect(env.path).toBe("/tools/base64-encoder");
    expect(env.path).not.toContain("?");
    expect(env.path).not.toContain("#");
  });

  it("includes a version string", () => {
    expect(typeof collectEnv().version).toBe("string");
  });

  it("redacts unknown/dynamic paths, keeping only known routes and tool slugs", () => {
    window.history.replaceState({}, "", "/customer/acme-secret");
    expect(collectEnv().path).toBe("/(other)");

    window.history.replaceState({}, "", "/tools/not-a-real-tool-xyz");
    expect(collectEnv().path).toBe("/tools/(unknown)");

    window.history.replaceState({}, "", "/privacy");
    expect(collectEnv().path).toBe("/privacy");
  });

  it("reports a coarse viewport bucket, not exact pixels", () => {
    const env = collectEnv();
    expect(env.viewport).not.toMatch(/\d{3,}/);
    expect(["xs", "sm", "md", "lg", "xl", "2xl"]).toContain(env.viewport.replace(" retina", ""));
  });
});

describe("error buffer", () => {
  it("normalizes non-Error inputs (string, object reason)", () => {
    pushError("plain string failure", { source: "test" });
    expect(latestError()?.message).toContain("plain string failure");
    pushError({ reason: "rejected" }, { source: "test" });
    expect(latestError()?.message).toContain("rejected");
  });

  it("caps at 5 entries and returns the newest", () => {
    for (let i = 0; i < 8; i++) {
      pushError(new Error(`err-${i}`), { source: "test" });
    }
    expect(latestError()?.message).toBe("err-7");
  });

  it("normalizes a mutated/unknown error name to a safe allowlisted category", () => {
    const evil = new Error("boom");
    evil.name = "Leaked <user input>";
    pushError(evil, { source: "test" });
    expect(latestError()?.name).toBe("Error");

    pushError(new TypeError("x"), { source: "test" });
    expect(latestError()?.name).toBe("TypeError");
  });
});

describe("buildIssueUrl", () => {
  it("targets tareqmlx/utilbench with bug label, URL-encoded", () => {
    const url = buildIssueUrl();
    expect(url).toContain("https://github.com/tareqmlx/utilbench/issues/new");
    expect(url).toContain("labels=bug");
    expect(url).toContain("title=");
    expect(url).toContain("body=");
  });

  it("stays under 6 KB even with a huge injected stack (truncation works)", () => {
    const err = {
      name: "TypeError",
      message: "x is undefined",
      stack: Array.from({ length: 2000 }, (_, i) => `at fn${i} (Route.tsx:${i}:1)`).join("\n"),
      source: "test",
      at: "2026-01-01T00:00:00.000Z",
    };
    const url = buildIssueUrl({ error: err });
    expect(url.length).toBeLessThan(6144);
  });

  it("uses the error category in the title, never the free-form message", () => {
    const err = {
      name: "SyntaxError",
      message: "secret user input here",
      stack: "",
      source: "test",
      at: "2026-01-01T00:00:00.000Z",
    };
    // URLSearchParams encodes spaces as "+", which decodeURIComponent leaves intact.
    const decoded = decodeURIComponent(buildIssueUrl({ error: err })).replace(/\+/g, " ");
    expect(decoded).toContain("SyntaxError");
    // Free-form message must not reach the URL at all — not title, not body.
    expect(decoded).not.toContain("secret");
  });

  it("normalizes an unsafe error name in the title even via a direct call", () => {
    const err = {
      name: "Evil <script>",
      message: "",
      stack: "",
      source: "test",
      at: "2026-01-01T00:00:00.000Z",
    };
    const decoded = decodeURIComponent(buildIssueUrl({ error: err })).replace(/\+/g, " ");
    expect(decoded).toContain("[bug] Error");
    expect(decoded).not.toContain("Evil");
  });

  it("does not leak query strings from the current location", () => {
    window.history.replaceState({}, "", "/tools/base64-encoder?query=LEAKME");
    const url = buildIssueUrl();
    expect(decodeURIComponent(url)).not.toContain("LEAKME");
  });
});
