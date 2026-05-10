import {
  Check,
  CheckCircle,
  CircleAlert,
  ClipboardPaste,
  Copy,
  Info,
  Minus,
  Trash2,
} from "lucide-react";
import type { ReactNode } from "react";
import { useCallback, useRef, useState } from "react";
import { IconSwap } from "../../components/IconSwap";
import { ErrorAlert, ToolShell } from "../../components/tool-layout";
import { Button } from "../../components/ui/button";
import { Card, CardContent } from "../../components/ui/card";
import { Label } from "../../components/ui/label";
import { Switch } from "../../components/ui/switch";
import { Textarea } from "../../components/ui/textarea";
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

function renderColoredJson(obj: Record<string, unknown>, colorClass: string): ReactNode {
  const json = JSON.stringify(obj, null, 2);
  const lines = json.split("\n");
  return lines.map((line, i) => {
    const match = line.match(/^(\s*)"([^"]+)"(:)/);
    if (match) {
      const indent = match[1] ?? "";
      const key = match[2] ?? "";
      const rest = line.slice(match[0]?.length);
      return (
        // biome-ignore lint/suspicious/noArrayIndexKey: static JSON lines never reorder
        <span key={i}>
          {`${indent}"`}
          <span className={colorClass}>{key}</span>
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
  });
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

  const inputRingClass = isIdle
    ? ""
    : error !== null
      ? "ring-2 ring-red-500/50 border-transparent"
      : "ring-2 ring-emerald-500/50 border-transparent";

  const timeClaims = jwt ? extractTimeClaims(jwt.payload) : [];
  const isExpired =
    jwt && typeof jwt.payload.exp === "number" && jwt.payload.exp * 1000 < Date.now();

  return (
    <ToolShell variant="wide">
      <div className="grid grid-cols-1 gap-8 lg:grid-cols-12">
        <div className="space-y-6 lg:col-span-5">
          <div className="space-y-3">
            <Label
              htmlFor="jwt-decoder-token"
              className="block text-sm font-bold tracking-widest text-muted-foreground uppercase"
            >
              Encoded Token
            </Label>
            <div className="group relative">
              <Textarea
                id="jwt-decoder-token"
                value={token}
                onChange={handleInputChange}
                className={`h-64 w-full resize-none p-6 font-mono text-sm sm:h-96 lg:h-125 ${inputRingClass}`}
                placeholder="Paste your JWT here..."
              />
              <div className="absolute right-4 bottom-4 flex gap-2">
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={handlePaste}
                  aria-label="Paste"
                  className="bg-muted shadow-sm"
                >
                  {pasteFeedback ? (
                    <Check className="h-4 w-4" />
                  ) : (
                    <ClipboardPaste className="h-4 w-4" />
                  )}
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={handleClear}
                  aria-label="Clear"
                  className="bg-muted shadow-sm"
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            </div>
            <ErrorAlert error={error} className="mt-3" />
          </div>

          <Card>
            <CardContent className="p-5 sm:pt-5">
              <h4 className="mb-3 flex items-center gap-2 text-sm font-bold">
                <Info className="h-4.5 w-4.5 text-primary" />
                Decoding Status
              </h4>
              {isIdle ? (
                <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
                  <Minus className="h-4 w-4" />
                  Waiting for token input
                </div>
              ) : error !== null ? (
                <div className="flex items-center gap-2 text-sm font-medium text-red-600 dark:text-red-400">
                  <CircleAlert className="h-4 w-4" />
                  Invalid Token Format
                </div>
              ) : (
                <div className="flex items-center gap-2 text-sm font-medium text-green-600 dark:text-green-400">
                  <CheckCircle className="h-4 w-4" />
                  Valid Token Format Detected
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        <div className="space-y-8 lg:col-span-7">
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <span className="block text-sm font-bold tracking-widest text-muted-foreground uppercase">
                Header
              </span>
              <div className="flex items-center gap-2">
                <span className="rounded bg-red-100 px-2 py-0.5 text-[10px] font-bold tracking-tighter text-red-600 uppercase dark:bg-red-900/30 dark:text-red-400">
                  Algorithm &amp; Type
                </span>
                {jwt && (
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={handleCopyHeader}
                    aria-label="Copy header"
                    className="h-8 w-8 bg-muted shadow-sm"
                  >
                    <IconSwap swapKey={copiedHeader}>
                      {copiedHeader ? (
                        <Check className="h-3.5 w-3.5" />
                      ) : (
                        <Copy className="h-3.5 w-3.5" />
                      )}
                    </IconSwap>
                  </Button>
                )}
              </div>
            </div>
            <Card>
              <CardContent className="p-6 sm:pt-6">
                {jwt ? (
                  <pre className="overflow-x-auto font-mono text-sm leading-relaxed text-foreground">
                    {renderColoredJson(jwt.header, "text-red-500")}
                  </pre>
                ) : (
                  <p className="text-sm text-muted-foreground italic">
                    {isIdle ? "Enter a token to see the header" : "\u2014"}
                  </p>
                )}
              </CardContent>
            </Card>
          </div>

          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <span className="block text-sm font-bold tracking-widest text-muted-foreground uppercase">
                Payload
              </span>
              <div className="flex items-center gap-2">
                <span className="rounded bg-purple-100 px-2 py-0.5 text-[10px] font-bold tracking-tighter text-purple-600 uppercase dark:bg-purple-900/30 dark:text-purple-400">
                  Data &amp; Claims
                </span>
                {jwt && (
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={handleCopyPayload}
                    aria-label="Copy payload"
                    className="h-8 w-8 bg-muted shadow-sm"
                  >
                    <IconSwap swapKey={copiedPayload}>
                      {copiedPayload ? (
                        <Check className="h-3.5 w-3.5" />
                      ) : (
                        <Copy className="h-3.5 w-3.5" />
                      )}
                    </IconSwap>
                  </Button>
                )}
              </div>
            </div>
            <Card>
              <CardContent className="p-6 sm:pt-6">
                {jwt ? (
                  <pre className="overflow-x-auto font-mono text-sm leading-relaxed text-foreground">
                    {renderColoredJson(jwt.payload, "text-purple-500")}
                  </pre>
                ) : (
                  <p className="text-sm text-muted-foreground italic">
                    {isIdle ? "Enter a token to see the payload" : "\u2014"}
                  </p>
                )}
              </CardContent>
            </Card>
            {jwt && timeClaims.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-2">
                {timeClaims.map((claim) => (
                  <div
                    key={claim.key}
                    className="rounded-full bg-muted px-3 py-1 text-[11px] font-medium text-muted-foreground"
                  >
                    {claim.label}:{" "}
                    <span className="text-foreground">{claim.date.toLocaleString()}</span>
                  </div>
                ))}
                {typeof jwt.payload.exp === "number" && (
                  <div
                    className={`rounded-full px-3 py-1 text-[11px] font-bold ${
                      isExpired
                        ? "bg-red-100 text-red-600 dark:bg-red-900/30 dark:text-red-400"
                        : "bg-green-100 text-green-600 dark:bg-green-900/30 dark:text-green-400"
                    }`}
                  >
                    {isExpired ? "Expired" : "Active"}
                  </div>
                )}
              </div>
            )}
          </div>

          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <span className="block text-sm font-bold tracking-widest text-muted-foreground uppercase">
                Signature
              </span>
              <span className="rounded bg-blue-100 px-2 py-0.5 text-[10px] font-bold tracking-tighter text-blue-600 uppercase dark:bg-blue-900/30 dark:text-blue-400">
                Integrity Check
              </span>
            </div>
            <Card>
              <CardContent className="p-6 sm:pt-6">
                {jwt ? (
                  <>
                    <div className="mb-4 break-all font-mono text-sm leading-relaxed text-blue-500">
                      {getAlgorithmDisplay(jwt.header)}(
                      <br />
                      {"\u00A0\u00A0"}base64UrlEncode(header) + "." +
                      <br />
                      {"\u00A0\u00A0"}base64UrlEncode(payload),
                      <br />
                      {"\u00A0\u00A0"}
                      <span className="rounded border border-blue-200 bg-blue-50 px-1 py-0.5 italic dark:border-blue-700 dark:bg-blue-900/30">
                        your-256-bit-secret
                      </span>
                      <br />)
                    </div>
                    <div className="border-t border-border pt-4">
                      <div className="flex items-center gap-2">
                        <Switch checked={false} disabled aria-label="Secret Base64 Encoded" />
                        <Label>Secret Base64 Encoded</Label>
                      </div>
                    </div>
                  </>
                ) : (
                  <p className="text-sm text-muted-foreground italic">
                    {isIdle ? "Enter a token to see the signature" : "\u2014"}
                  </p>
                )}
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </ToolShell>
  );
}
