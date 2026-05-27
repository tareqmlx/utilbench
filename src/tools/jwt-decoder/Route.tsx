import { Check, CircleAlert, CircleCheck, ClipboardPaste, Copy, Minus, Trash2 } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { IconSwap } from "../../components/IconSwap";
import { ErrorAlert, PaneHeader, StatusBadge, ToolShell } from "../../components/tool-layout";
import { Label } from "../../components/ui/label";
import { useClipboard } from "../../hooks/useClipboard";
import { cn } from "../../lib/utils";

const SAMPLE_TOKEN =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIiwiaWF0IjoxNTE2MjM5MDIyfQ.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c";

const metaLabelCls = "wb-meta block";

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
              <span className="font-semibold text-ink-2">{key}</span>
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

interface ResultPanelProps {
  label: string;
  copyHandler?: (() => void) | undefined;
  copied: boolean;
  copyLabel: string;
  children: React.ReactNode;
  empty: boolean;
  emptyHint: string;
}

function ResultPanel({
  label,
  copyHandler,
  copied,
  copyLabel,
  children,
  empty,
  emptyHint,
}: ResultPanelProps) {
  return (
    <section className="wb-panel">
      <PaneHeader
        label={label}
        actions={
          copyHandler && !empty ? (
            <button
              type="button"
              onClick={copyHandler}
              aria-label={copyLabel}
              className="wb-btn wb-btn--sm wb-btn--ghost min-h-11 sm:min-h-0"
            >
              <IconSwap swapKey={copied}>
                {copied ? (
                  <Check className="size-3.5" aria-hidden="true" />
                ) : (
                  <Copy className="size-3.5" aria-hidden="true" />
                )}
              </IconSwap>
              <span>{copied ? "Copied" : "Copy"}</span>
            </button>
          ) : null
        }
      />
      <div className="p-5">
        {empty ? <p className="wb-mono-sm italic text-ink-3">{emptyHint}</p> : children}
      </div>
    </section>
  );
}

export default function JwtDecoderRoute() {
  const [token, setToken] = useState(SAMPLE_TOKEN);
  const [decodeResult, setDecodeResult] = useState<DecodeResult>(() => decodeJwt(SAMPLE_TOKEN));
  const [justPasted, setJustPasted] = useState(false);
  const [statusMessage, setStatusMessage] = useState("");
  const pasteTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const { copy: copyHeader, copied: copiedHeader } = useClipboard();
  const { copy: copyPayload, copied: copiedPayload } = useClipboard();
  const { copy: copySignature, copied: copiedSignature } = useClipboard();
  const { readClipboard } = useClipboard();

  useEffect(
    () => () => {
      if (pasteTimerRef.current) clearTimeout(pasteTimerRef.current);
    },
    [],
  );

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
    setJustPasted(true);
    setStatusMessage("Token pasted from clipboard.");
    if (pasteTimerRef.current) clearTimeout(pasteTimerRef.current);
    pasteTimerRef.current = setTimeout(() => setJustPasted(false), 1500);
  }, [readClipboard]);

  const handleClear = useCallback(() => {
    setToken("");
    setDecodeResult({ jwt: null, error: null });
    setStatusMessage("Token cleared.");
  }, []);

  const handleCopyHeader = useCallback(() => {
    if (decodeResult.jwt) {
      copyHeader(JSON.stringify(decodeResult.jwt.header, null, 2));
      setStatusMessage("Header copied to clipboard.");
    }
  }, [copyHeader, decodeResult.jwt]);

  const handleCopyPayload = useCallback(() => {
    if (decodeResult.jwt) {
      copyPayload(JSON.stringify(decodeResult.jwt.payload, null, 2));
      setStatusMessage("Payload copied to clipboard.");
    }
  }, [copyPayload, decodeResult.jwt]);

  const handleCopySignature = useCallback(() => {
    if (decodeResult.jwt) {
      copySignature(decodeResult.jwt.signature);
      setStatusMessage("Signature copied to clipboard.");
    }
  }, [copySignature, decodeResult.jwt]);

  const { jwt, error } = decodeResult;
  const isIdle = token.trim() === "";
  const statusState: "idle" | "invalid" | "valid" = isIdle
    ? "idle"
    : error !== null
      ? "invalid"
      : "valid";

  const timeClaims = jwt ? extractTimeClaims(jwt.payload) : [];
  const isExpired =
    jwt && typeof jwt.payload.exp === "number" && jwt.payload.exp * 1000 < Date.now();
  const hasExp = jwt && typeof jwt.payload.exp === "number";
  const headerKey = jwt ? JSON.stringify(jwt.header) : "empty";
  const payloadKey = jwt ? JSON.stringify(jwt.payload) : "empty";
  const claimsKey = jwt
    ? `${jwt.payload.iat ?? ""}|${jwt.payload.exp ?? ""}|${jwt.payload.nbf ?? ""}|${isExpired}`
    : "empty";
  const signatureKey = jwt ? getAlgorithmDisplay(jwt.header) : "empty";

  return (
    <ToolShell variant="wide">
      <output aria-live="polite" className="sr-only">
        {statusMessage}
      </output>
      <div className="grid grid-cols-1 gap-8 lg:grid-cols-12">
        <div className="lg:col-span-5">
          <div className="space-y-6 lg:sticky lg:top-24">
            <div className="space-y-3">
              <div className="flex items-end justify-between gap-3">
                <Label htmlFor="jwt-decoder-token" className={metaLabelCls}>
                  Encoded Token
                </Label>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={handlePaste}
                    aria-label="Paste"
                    className="wb-btn wb-btn--sm wb-btn--ghost min-h-11 sm:min-h-0"
                  >
                    <IconSwap swapKey={justPasted}>
                      {justPasted ? (
                        <Check className="size-3.5" aria-hidden="true" strokeWidth={2.5} />
                      ) : (
                        <ClipboardPaste className="size-3.5" aria-hidden="true" />
                      )}
                    </IconSwap>
                    <span>{justPasted ? "Pasted" : "Paste"}</span>
                  </button>
                  <button
                    type="button"
                    onClick={handleClear}
                    aria-label="Clear"
                    disabled={isIdle}
                    className="wb-btn wb-btn--sm wb-btn--ghost min-h-11 sm:min-h-0"
                  >
                    <Trash2 className="size-3.5" aria-hidden="true" />
                    <span>Clear</span>
                  </button>
                </div>
              </div>
              <textarea
                id="jwt-decoder-token"
                value={token}
                onChange={handleInputChange}
                spellCheck={false}
                autoCorrect="off"
                autoCapitalize="off"
                className="h-64 w-full resize-none rounded-lg border-2 border-ink bg-paper p-5 font-mono text-[13px] leading-relaxed text-ink shadow-pop-3 placeholder:text-ink-3 focus:outline-none focus-visible:ring-2 focus-visible:ring-tomato focus-visible:ring-offset-2 focus-visible:ring-offset-paper sm:h-96 lg:h-125"
                placeholder="Paste your JWT here…"
                aria-describedby={error ? "jwt-decoder-error" : undefined}
                aria-invalid={error !== null || undefined}
              />
              <ErrorAlert error={error} id="jwt-decoder-error" />
            </div>

            <section className="wb-panel wb-panel--out">
              <PaneHeader label="Status" className="bg-paper-2" />
              <div key={statusState} className="wb-fade-in px-5 py-4">
                {isIdle ? (
                  <div className="flex items-center gap-2.5 text-[14px] font-medium text-ink-2">
                    <Minus className="size-4" strokeWidth={2.5} aria-hidden="true" />
                    Waiting for token input
                  </div>
                ) : error !== null ? (
                  <div className="flex items-center gap-2.5 text-[14px] font-medium text-ink">
                    <CircleAlert
                      className="size-4 text-tomato"
                      strokeWidth={2.5}
                      aria-hidden="true"
                    />
                    Invalid Token Format
                  </div>
                ) : (
                  <div className="flex items-center gap-2.5 text-[14px] font-medium text-ink">
                    <CircleCheck
                      className="size-4 text-grass"
                      strokeWidth={2.5}
                      aria-hidden="true"
                    />
                    Valid Token Format Detected
                  </div>
                )}
              </div>
            </section>
          </div>
        </div>

        <div className="space-y-6 lg:col-span-7">
          <ResultPanel
            label="Header"
            copyHandler={jwt ? handleCopyHeader : undefined}
            copied={copiedHeader}
            copyLabel="Copy header"
            empty={!jwt}
            emptyHint={
              isIdle
                ? "Enter a token to see the header"
                : "Header unavailable until the token parses."
            }
          >
            {jwt && (
              <div key={headerKey} className="wb-fade-in">
                <JsonBlock data={jwt.header} />
              </div>
            )}
          </ResultPanel>

          <div className="space-y-3">
            <ResultPanel
              label="Payload"
              copyHandler={jwt ? handleCopyPayload : undefined}
              copied={copiedPayload}
              copyLabel="Copy payload"
              empty={!jwt}
              emptyHint={
                isIdle
                  ? "Enter a token to see the payload"
                  : "Payload unavailable until the token parses."
              }
            >
              {jwt && (
                <div key={payloadKey} className="wb-fade-in">
                  <JsonBlock data={jwt.payload} />
                </div>
              )}
            </ResultPanel>

            {jwt && (timeClaims.length > 0 || hasExp) && (
              <div key={claimsKey} className="wb-fade-in flex flex-wrap items-center gap-2">
                {timeClaims.map((claim) => {
                  const formattedDate = claim.date.toLocaleString();
                  return (
                    <dl
                      key={claim.key}
                      className={cn(
                        "inline-flex items-center gap-1.5 rounded-full border-2 border-ink bg-paper px-3 py-1",
                        "font-mono text-[11px] text-ink-2",
                      )}
                    >
                      <dt className="uppercase tracking-wider text-ink-3">{claim.label}</dt>
                      <dd className="text-ink">{formattedDate}</dd>
                    </dl>
                  );
                })}
                {hasExp && (
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
            copyHandler={jwt ? handleCopySignature : undefined}
            copied={copiedSignature}
            copyLabel="Copy signature"
            empty={!jwt}
            emptyHint={
              isIdle
                ? "Enter a token to see the signature"
                : "Signature unavailable until the token parses."
            }
          >
            {jwt && (
              <div
                key={signatureKey}
                className="wb-fade-in break-all font-mono text-[13px] leading-relaxed text-ink"
              >
                {getAlgorithmDisplay(jwt.header)}(
                <br />
                {"  "}base64UrlEncode(header) + "." +
                <br />
                {"  "}base64UrlEncode(payload),
                <br />
                {"  "}
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
