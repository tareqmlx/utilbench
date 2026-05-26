import { Check, CircleAlert, CircleCheck, ClipboardPaste, Copy, Minus, Trash2 } from "lucide-react";
import { useCallback, useRef, useState } from "react";
import { IconSwap } from "../../components/IconSwap";
import { ErrorAlert, StatusBadge, ToolShell } from "../../components/tool-layout";
import { useClipboard } from "../../hooks/useClipboard";

const SAMPLE_TOKEN =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIiwiaWF0IjoxNTE2MjM5MDIyfQ.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c";

interface DecodedJwt {
  header: Record<string, unknown>;
  payload: Record<string, unknown>;
  signature: string;
}

interface DecodeResult {
  jwt: DecodedJwt | null;
  error: string | null;
}

interface TimeClaim {
  label: string;
  key: string;
  date: Date;
}

function base64UrlDecode(str: string): string {
  let base64 = str.replace(/-/g, "+").replace(/_/g, "/");
  const padding = base64.length % 4;
  if (padding === 2) base64 += "==";
  else if (padding === 3) base64 += "=";
  return atob(base64);
}

function decodeJwt(token: string): DecodeResult {
  const trimmed = token.trim();
  if (trimmed === "") return { jwt: null, error: null };

  const parts = trimmed.split(".");
  if (parts.length !== 3) {
    return { jwt: null, error: "Invalid JWT: expected 3 parts separated by dots" };
  }

  const headerB64 = parts[0] ?? "";
  const payloadB64 = parts[1] ?? "";
  const signatureB64 = parts[2] ?? "";

  let header: unknown;
  try {
    header = JSON.parse(base64UrlDecode(headerB64));
  } catch {
    return { jwt: null, error: "Invalid JWT: header is not valid base64 JSON" };
  }

  let payload: unknown;
  try {
    payload = JSON.parse(base64UrlDecode(payloadB64));
  } catch {
    return { jwt: null, error: "Invalid JWT: payload is not valid base64 JSON" };
  }

  if (typeof header !== "object" || header === null || Array.isArray(header)) {
    return { jwt: null, error: "Invalid JWT: header must be a JSON object" };
  }

  if (typeof payload !== "object" || payload === null || Array.isArray(payload)) {
    return { jwt: null, error: "Invalid JWT: payload must be a JSON object" };
  }

  return {
    jwt: {
      header: header as Record<string, unknown>,
      payload: payload as Record<string, unknown>,
      signature: signatureB64,
    },
    error: null,
  };
}

const TIME_CLAIM_MAP: Record<string, string> = {
  iat: "Issued At",
  exp: "Expires",
  nbf: "Not Before",
};

function extractTimeClaims(payload: Record<string, unknown>): TimeClaim[] {
  const claims: TimeClaim[] = [];
  for (const [key, label] of Object.entries(TIME_CLAIM_MAP)) {
    const value = payload[key];
    if (typeof value === "number") {
      claims.push({ label, key, date: new Date(value * 1000) });
    }
  }
  return claims;
}

const ALGORITHM_MAP: Record<string, string> = {
  HS256: "HMACSHA256",
  HS384: "HMACSHA384",
  HS512: "HMACSHA512",
  RS256: "RSASHA256",
  RS384: "RSASHA384",
  RS512: "RSASHA512",
  ES256: "ECDSASHA256",
  ES384: "ECDSASHA384",
  ES512: "ECDSASHA512",
  PS256: "RSASSAPSSSHA256",
  PS384: "RSASSAPSSSHA384",
  PS512: "RSASSAPSSSHA512",
};

function getAlgorithmDisplay(header: Record<string, unknown>): string {
  const alg = header.alg;
  if (typeof alg !== "string") return "UNKNOWN";
  return ALGORITHM_MAP[alg] ?? alg;
}

function JsonBlock({ data }: { data: Record<string, unknown> }) {
  const json = JSON.stringify(data, null, 2);
  const lines = json.split("\n");
  return (
    <pre className="overflow-x-auto font-mono text-[13px] leading-relaxed text-ink">
      {lines.map((line, i) => {
        const match = line.match(/^(\s*)"([^"]+)"(:)/);
        if (match) {
          const indent = match[1] ?? "";
          const key = match[2] ?? "";
          const rest = line.slice(match[0]?.length);
          return (
            // biome-ignore lint/suspicious/noArrayIndexKey: static JSON lines never reorder
            <span key={i}>
              {`${indent}"`}
              <span className="text-ink-2">{key}</span>
              {`":${rest}`}
              {i < lines.length - 1 ? "\n" : ""}
            </span>
          );
        }
        return (
          // biome-ignore lint/suspicious/noArrayIndexKey: static JSON lines never reorder
          <span key={i}>
            {line}
            {i < lines.length - 1 ? "\n" : ""}
          </span>
        );
      })}
    </pre>
  );
}

interface PanelProps {
  label: string;
  sticker: { tone: "mint" | "lilac" | "sky"; text: string };
  copyHandler?: (() => void) | undefined;
  copied?: boolean;
  children: React.ReactNode;
  empty: boolean;
  emptyHint: string;
}

function ResultPanel({
  label,
  sticker,
  copyHandler,
  copied,
  children,
  empty,
  emptyHint,
}: PanelProps) {
  return (
    <div className="rounded-lg border-2 border-ink bg-paper shadow-pop-3 overflow-hidden">
      <div className="flex items-center justify-between border-b-2 border-ink bg-paper-2 px-[18px] py-[14px]">
        <div className="flex items-center gap-2.5">
          <span className="font-mono text-[11px] uppercase tracking-[0.12em] text-ink-3">
            {label}
          </span>
          <span className={`wb-sticker wb-sticker--${sticker.tone} !py-1 !px-2 !text-[10.5px]`}>
            {sticker.text}
          </span>
        </div>
        {copyHandler && !empty && (
          <button
            type="button"
            onClick={copyHandler}
            aria-label={`Copy ${label.toLowerCase()}`}
            className="wb-btn wb-btn--sm wb-btn--ghost"
          >
            <IconSwap swapKey={copied}>
              {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
            </IconSwap>
            <span>{copied ? "Copied" : "Copy"}</span>
          </button>
        )}
      </div>
      <div className="p-5">
        {empty ? <p className="font-mono text-[12px] italic text-ink-3">{emptyHint}</p> : children}
      </div>
    </div>
  );
}

export default function JwtDecoderRoute() {
  const [token, setToken] = useState(SAMPLE_TOKEN);
  const [decodeResult, setDecodeResult] = useState<DecodeResult>(() => decodeJwt(SAMPLE_TOKEN));
  const [pasteFeedback, setPasteFeedback] = useState(false);
  const pasteTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const { copy: copyHeader, copied: copiedHeader } = useClipboard();
  const { copy: copyPayload, copied: copiedPayload } = useClipboard();
  const { readClipboard } = useClipboard();

  const handleInputChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const val = e.target.value;
    setToken(val);
    setDecodeResult(decodeJwt(val));
  }, []);

  const handlePaste = useCallback(async () => {
    const text = await readClipboard();
    if (text === null) return;
    setToken(text);
    setDecodeResult(decodeJwt(text));
    setPasteFeedback(true);
    if (pasteTimerRef.current) clearTimeout(pasteTimerRef.current);
    pasteTimerRef.current = setTimeout(() => setPasteFeedback(false), 1500);
  }, [readClipboard]);

  const handleClear = useCallback(() => {
    setToken("");
    setDecodeResult({ jwt: null, error: null });
  }, []);

  const handleCopyHeader = useCallback(() => {
    if (decodeResult.jwt) {
      copyHeader(JSON.stringify(decodeResult.jwt.header, null, 2));
    }
  }, [copyHeader, decodeResult.jwt]);

  const handleCopyPayload = useCallback(() => {
    if (decodeResult.jwt) {
      copyPayload(JSON.stringify(decodeResult.jwt.payload, null, 2));
    }
  }, [copyPayload, decodeResult.jwt]);

  const { jwt, error } = decodeResult;
  const isIdle = token.trim() === "";

  const timeClaims = jwt ? extractTimeClaims(jwt.payload) : [];
  const isExpired =
    jwt && typeof jwt.payload.exp === "number" && jwt.payload.exp * 1000 < Date.now();

  return (
    <ToolShell variant="wide">
      <div className="grid grid-cols-1 gap-8 lg:grid-cols-12">
        <div className="space-y-6 lg:col-span-5">
          <div className="space-y-3">
            <label
              htmlFor="jwt-decoder-token"
              className="font-mono text-[11px] uppercase tracking-[0.12em] text-ink-3"
            >
              Encoded Token
            </label>
            <div className="relative">
              <textarea
                id="jwt-decoder-token"
                value={token}
                onChange={handleInputChange}
                className="h-64 w-full resize-none rounded-lg border-2 border-ink bg-paper p-5 pr-20 font-mono text-[13px] leading-relaxed text-ink shadow-pop-3 placeholder:text-ink-3 focus:outline-none focus-visible:ring-2 focus-visible:ring-tomato focus-visible:ring-offset-2 focus-visible:ring-offset-paper sm:h-96 lg:h-125"
                placeholder="Paste your JWT here…"
              />
              <div className="absolute right-3 bottom-3 flex gap-2">
                <button
                  type="button"
                  onClick={handlePaste}
                  aria-label="Paste"
                  className="grid size-9 place-items-center rounded-md border-2 border-ink bg-paper text-ink shadow-pop-1 transition-transform hover:-translate-y-0.5"
                >
                  {pasteFeedback ? (
                    <Check className="size-4" strokeWidth={2.5} />
                  ) : (
                    <ClipboardPaste className="size-4" strokeWidth={2} />
                  )}
                </button>
                <button
                  type="button"
                  onClick={handleClear}
                  aria-label="Clear"
                  className="grid size-9 place-items-center rounded-md border-2 border-ink bg-paper text-ink shadow-pop-1 transition-transform hover:-translate-y-0.5"
                >
                  <Trash2 className="size-4" strokeWidth={2} />
                </button>
              </div>
            </div>
            <ErrorAlert error={error} />
          </div>

          <div className="rounded-lg border-2 border-ink bg-paper-2 p-5 shadow-pop-3">
            <span className="mb-3 block font-mono text-[11px] uppercase tracking-[0.12em] text-ink-3">
              Decoding Status
            </span>
            {isIdle ? (
              <div className="flex items-center gap-2.5 text-[14px] font-medium text-ink-2">
                <Minus className="size-4" strokeWidth={2.5} />
                Waiting for token input
              </div>
            ) : error !== null ? (
              <div className="flex items-center gap-2.5 text-[14px] font-medium text-ink">
                <CircleAlert className="size-4 text-tomato" strokeWidth={2.5} />
                Invalid Token Format
              </div>
            ) : (
              <div className="flex items-center gap-2.5 text-[14px] font-medium text-ink">
                <CircleCheck className="size-4 text-grass" strokeWidth={2.5} />
                Valid Token Format Detected
              </div>
            )}
          </div>
        </div>

        <div className="space-y-7 lg:col-span-7">
          <ResultPanel
            label="Header"
            sticker={{ tone: "mint", text: "Algorithm & Type" }}
            copyHandler={jwt ? handleCopyHeader : undefined}
            copied={copiedHeader}
            empty={!jwt}
            emptyHint={isIdle ? "Enter a token to see the header" : "—"}
          >
            {jwt && <JsonBlock data={jwt.header} />}
          </ResultPanel>

          <div className="space-y-3">
            <ResultPanel
              label="Payload"
              sticker={{ tone: "lilac", text: "Data & Claims" }}
              copyHandler={jwt ? handleCopyPayload : undefined}
              copied={copiedPayload}
              empty={!jwt}
              emptyHint={isIdle ? "Enter a token to see the payload" : "—"}
            >
              {jwt && <JsonBlock data={jwt.payload} />}
            </ResultPanel>

            {jwt && timeClaims.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {timeClaims.map((claim) => (
                  <div
                    key={claim.key}
                    className="rounded-full border-2 border-ink bg-paper px-3 py-1 font-mono text-[11px] text-ink-2"
                  >
                    {claim.label}: <span className="text-ink">{claim.date.toLocaleString()}</span>
                  </div>
                ))}
                {typeof jwt.payload.exp === "number" && (
                  <StatusBadge
                    tone={isExpired ? "invalid" : "valid"}
                    label={isExpired ? "Expired" : "Active"}
                  />
                )}
              </div>
            )}
          </div>

          <ResultPanel
            label="Signature"
            sticker={{ tone: "sky", text: "Integrity Check" }}
            empty={!jwt}
            emptyHint={isIdle ? "Enter a token to see the signature" : "—"}
          >
            {jwt && (
              <div className="break-all font-mono text-[13px] leading-relaxed text-ink">
                {getAlgorithmDisplay(jwt.header)}(
                <br />
                {"  "}base64UrlEncode(header) + "." +
                <br />
                {"  "}base64UrlEncode(payload),
                <br />
                {"  "}
                <span className="rounded border-2 border-ink bg-lemon px-1.5 py-0.5 italic">
                  your-256-bit-secret
                </span>
                <br />)
              </div>
            )}
          </ResultPanel>
        </div>
      </div>
    </ToolShell>
  );
}
