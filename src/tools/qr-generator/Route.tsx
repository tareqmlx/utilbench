import {
  Check,
  CircleAlert,
  Copy,
  Download,
  Link2,
  Maximize,
  Share2,
  Type,
  Wifi,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { IconSwap } from "../../components/IconSwap";
import { KbdHint } from "../../components/KbdHint";
import { PaneHeader, ToolShell } from "../../components/tool-layout";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { Label } from "../../components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../../components/ui/select";
import { Slider } from "../../components/ui/slider";
import { Tabs, TabsList, TabsTrigger } from "../../components/ui/tabs";
import { useClipboard } from "../../hooks/useClipboard";
import { useKeyboardShortcut } from "../../hooks/useKeyboardShortcut";
import { useToolPreferences } from "../../hooks/useToolPreferences";
import { useUrlState } from "../../hooks/useUrlState";
import { cn } from "../../lib/utils";
import {
  type ContentType,
  type QrOptions,
  buildPayload,
  generateQrPng,
  generateQrSvg,
  isValidHexColor,
} from "./qr";

const contentTabs: ContentType[] = ["URL", "Text", "WiFi", "vCard"];

const formatTabs = ["SVG", "PNG"] as const;

const contentIcons: Record<ContentType, React.ComponentType<{ className?: string }>> = {
  URL: Link2,
  Text: Type,
  WiFi: Wifi,
  vCard: Type,
};

const DEFAULT_PREFS = {
  contentType: "URL" as ContentType,
  size: 512,
  errorCorrection: "M" as "L" | "M" | "Q" | "H",
  format: "SVG" as "SVG" | "PNG",
  foregroundColor: "#1f1a14",
  backgroundColor: "#fff7ec",
  quietZone: 4,
};

const URL_SCHEMA = {
  type: { type: "string" as const, defaultValue: "URL" },
  text: { type: "string" as const, defaultValue: "https://utilbench.io" },
};

const tabTriggerCls = cn(
  "wb-chip justify-center px-3 py-1.5 text-[12.5px] font-semibold sm:min-h-0",
  "data-[state=active]:bg-ink data-[state=active]:text-paper",
  "data-[state=active]:hover:bg-ink data-[state=active]:hover:text-paper",
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-tomato",
  "focus-visible:ring-offset-2 focus-visible:ring-offset-paper",
);

const metaLabelCls = "wb-meta block";

export default function QrGeneratorRoute() {
  const [prefs, setPrefs] = useToolPreferences("qr-generator", DEFAULT_PREFS);
  const [urlState, setUrlState] = useUrlState(URL_SCHEMA);
  const activeContentType = (urlState.type || prefs.contentType) as ContentType;
  const [textInput, setTextInput] = useState(urlState.text);
  const [wifiSsid, setWifiSsid] = useState("");
  const [wifiPassword, setWifiPassword] = useState("");
  const [vcardName, setVcardName] = useState("");
  const [vcardOrg, setVcardOrg] = useState("");
  const [qrOutput, setQrOutput] = useState<string | null>(null);
  const [qrError, setQrError] = useState<string | null>(null);
  const [status, setStatus] = useState("");

  const { copied, copy } = useClipboard();
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fgPickerRef = useRef<HTMLInputElement>(null);
  const bgPickerRef = useRef<HTMLInputElement>(null);
  const previewRef = useRef<HTMLDivElement>(null);

  const [canShare] = useState(() => typeof navigator.share === "function");
  const [canFullscreen] = useState(() => !!document.fullscreenEnabled);

  useKeyboardShortcut(
    useMemo(
      () => [{ key: "s", meta: true, handler: () => handleDownload(), enabled: !!qrOutput }],
      [qrOutput],
    ),
  );

  const generate = useCallback(async () => {
    const payload = buildPayload(activeContentType, {
      textInput,
      wifiSsid,
      wifiPassword,
      vcardName,
      vcardOrg,
    });

    if (!payload) {
      setQrOutput(null);
      setQrError(null);
      return;
    }

    const options: QrOptions = {
      size: prefs.size,
      errorCorrection: prefs.errorCorrection,
      foregroundColor: isValidHexColor(prefs.foregroundColor) ? prefs.foregroundColor : "#1f1a14",
      backgroundColor: isValidHexColor(prefs.backgroundColor) ? prefs.backgroundColor : "#fff7ec",
      quietZone: prefs.quietZone,
    };

    try {
      const result =
        prefs.format === "SVG"
          ? await generateQrSvg(payload, options)
          : await generateQrPng(payload, options);
      setQrOutput(result);
      setQrError(null);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to generate QR code";
      setQrError(message);
      setQrOutput(null);
      setStatus(`Error: ${message}`);
    }
  }, [prefs, activeContentType, textInput, wifiSsid, wifiPassword, vcardName, vcardOrg]);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(generate, 250);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [generate]);

  const currentPayload = useMemo(
    () =>
      buildPayload(activeContentType, {
        textInput,
        wifiSsid,
        wifiPassword,
        vcardName,
        vcardOrg,
      }),
    [activeContentType, textInput, wifiSsid, wifiPassword, vcardName, vcardOrg],
  );

  const handleDownload = () => {
    if (!qrOutput) return;

    const link = document.createElement("a");
    if (prefs.format === "SVG") {
      const blob = new Blob([qrOutput], { type: "image/svg+xml" });
      link.href = URL.createObjectURL(blob);
      link.download = "qrcode.svg";
    } else {
      link.href = qrOutput;
      link.download = "qrcode.png";
    }
    link.click();
    URL.revokeObjectURL(link.href);
    setStatus(`Downloaded as qrcode.${prefs.format.toLowerCase()}.`);
  };

  const handleCopy = async () => {
    if (!qrOutput) return;
    if (prefs.format === "SVG") {
      await copy(qrOutput);
    } else {
      try {
        const response = await fetch(qrOutput);
        const blob = await response.blob();
        await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
      } catch {
        await copy(qrOutput);
      }
    }
    setStatus("QR code copied to clipboard.");
  };

  const handleShare = async () => {
    if (!qrOutput || !canShare) return;
    try {
      if (prefs.format === "SVG") {
        const blob = new Blob([qrOutput], { type: "image/svg+xml" });
        const file = new File([blob], "qrcode.svg", { type: "image/svg+xml" });
        await navigator.share({ files: [file] });
      } else {
        const response = await fetch(qrOutput);
        const blob = await response.blob();
        const file = new File([blob], "qrcode.png", { type: "image/png" });
        await navigator.share({ files: [file] });
      }
    } catch {
      // User cancelled share dialog
    }
  };

  const handleFullscreen = async () => {
    if (!previewRef.current || !canFullscreen) return;
    try {
      if (document.fullscreenElement) {
        await document.exitFullscreen();
      } else {
        await previewRef.current.requestFullscreen();
      }
    } catch {
      // Fullscreen not supported in this context
    }
  };

  const handleForegroundChange = (value: string) => {
    setPrefs({ foregroundColor: value });
  };

  const handleBackgroundChange = (value: string) => {
    setPrefs({ backgroundColor: value });
  };

  const ContentIcon = contentIcons[activeContentType];

  return (
    <ToolShell>
      <output aria-live="polite" className="sr-only">
        {status}
      </output>
      <div className="grid grid-cols-1 gap-8 lg:grid-cols-12">
        {/* Configure */}
        <div className="space-y-6 lg:col-span-7">
          <section className="wb-panel">
            <Tabs
              value={activeContentType}
              onValueChange={(v) => {
                setPrefs({ contentType: v as ContentType });
                setUrlState({ type: v });
              }}
            >
              <PaneHeader
                label="Content"
                trailing={
                  <TabsList className="flex h-auto gap-1 bg-transparent p-0">
                    {contentTabs.map((tab) => (
                      <TabsTrigger key={tab} value={tab} className={tabTriggerCls}>
                        {tab}
                      </TabsTrigger>
                    ))}
                  </TabsList>
                }
              />

              <div className="space-y-5 p-5 sm:p-6">
                {(activeContentType === "URL" || activeContentType === "Text") && (
                  <div key={activeContentType} className="wb-fade-in relative">
                    <Input
                      type="text"
                      value={textInput}
                      onChange={(e) => {
                        setTextInput(e.target.value);
                        setUrlState({ text: e.target.value });
                      }}
                      placeholder={
                        activeContentType === "URL"
                          ? "https://yourlink.com"
                          : "Enter text content..."
                      }
                      className="h-12 pr-11 text-base"
                    />
                    <div className="pointer-events-none absolute top-1/2 right-3.5 -translate-y-1/2 text-ink-3">
                      <ContentIcon className="h-5 w-5" />
                    </div>
                  </div>
                )}

                {activeContentType === "WiFi" && (
                  <div key="wifi" className="wb-fade-in grid grid-cols-1 gap-4 sm:grid-cols-2">
                    <div className="space-y-2">
                      <Label htmlFor="qr-generator-network-ssid" className={metaLabelCls}>
                        Network SSID
                      </Label>
                      <Input
                        id="qr-generator-network-ssid"
                        type="text"
                        value={wifiSsid}
                        onChange={(e) => setWifiSsid(e.target.value)}
                        placeholder="Home_WiFi"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="qr-generator-network-password" className={metaLabelCls}>
                        Password
                      </Label>
                      <Input
                        id="qr-generator-network-password"
                        type="password"
                        value={wifiPassword}
                        onChange={(e) => setWifiPassword(e.target.value)}
                        placeholder="••••••••"
                      />
                    </div>
                  </div>
                )}

                {activeContentType === "vCard" && (
                  <div key="vcard" className="wb-fade-in grid grid-cols-1 gap-4 sm:grid-cols-2">
                    <div className="space-y-2">
                      <Label htmlFor="qr-generator-full-name" className={metaLabelCls}>
                        Full Name
                      </Label>
                      <Input
                        id="qr-generator-full-name"
                        type="text"
                        value={vcardName}
                        onChange={(e) => setVcardName(e.target.value)}
                        placeholder="John Doe"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="qr-generator-organization" className={metaLabelCls}>
                        Organization
                      </Label>
                      <Input
                        id="qr-generator-organization"
                        type="text"
                        value={vcardOrg}
                        onChange={(e) => setVcardOrg(e.target.value)}
                        placeholder="Utilbench Inc."
                      />
                    </div>
                  </div>
                )}
              </div>
            </Tabs>

            {/* Size · Correction · Format */}
            <div className="grid grid-cols-1 gap-5 border-t-2 border-ink p-5 sm:p-6 md:grid-cols-3">
              <div className="space-y-2">
                <Label htmlFor="qr-generator-size" className={metaLabelCls}>
                  Size
                </Label>
                <Select
                  value={String(prefs.size)}
                  onValueChange={(v) => setPrefs({ size: Number(v) })}
                >
                  <SelectTrigger id="qr-generator-size">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="256">256 × 256 px</SelectItem>
                    <SelectItem value="512">512 × 512 px</SelectItem>
                    <SelectItem value="1024">1024 × 1024 px</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label htmlFor="qr-generator-correction" className={metaLabelCls}>
                  Correction
                </Label>
                <Select
                  value={prefs.errorCorrection}
                  onValueChange={(v) => setPrefs({ errorCorrection: v as "L" | "M" | "Q" | "H" })}
                >
                  <SelectTrigger id="qr-generator-correction">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="L">Low · 7%</SelectItem>
                    <SelectItem value="M">Medium · 15%</SelectItem>
                    <SelectItem value="Q">High · 25%</SelectItem>
                    <SelectItem value="H">Ultra · 30%</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <span className={metaLabelCls}>Format</span>
                <Tabs
                  value={prefs.format}
                  onValueChange={(v) => setPrefs({ format: v as "SVG" | "PNG" })}
                >
                  <TabsList className="flex h-auto w-full gap-1 bg-transparent p-0">
                    {formatTabs.map((tab) => (
                      <TabsTrigger key={tab} value={tab} className={cn(tabTriggerCls, "flex-1")}>
                        {tab}
                      </TabsTrigger>
                    ))}
                  </TabsList>
                </Tabs>
              </div>
            </div>

            {/* Foreground · Background · Quiet zone */}
            <div className="grid grid-cols-1 gap-5 border-t-2 border-ink p-5 sm:p-6 md:grid-cols-3">
              <ColorField
                id="qr-generator-foreground"
                label="Foreground"
                value={prefs.foregroundColor}
                fallback="#1f1a14"
                onChange={handleForegroundChange}
                pickerRef={fgPickerRef}
                ariaLabel="Pick foreground color"
              />
              <ColorField
                id="qr-generator-background"
                label="Background"
                value={prefs.backgroundColor}
                fallback="#fff7ec"
                onChange={handleBackgroundChange}
                pickerRef={bgPickerRef}
                ariaLabel="Pick background color"
              />

              <div className="space-y-2">
                <Label htmlFor="qr-generator-quiet-zone" className={metaLabelCls}>
                  Quiet zone
                </Label>
                <div className="flex h-10 items-center gap-4">
                  <Slider
                    id="qr-generator-quiet-zone"
                    min={0}
                    max={10}
                    step={1}
                    value={[prefs.quietZone]}
                    onValueChange={([v]) => setPrefs({ quietZone: v })}
                    className="flex-1"
                  />
                  <span
                    key={prefs.quietZone}
                    className="wb-fade-in wb-mono-sm w-10 shrink-0 text-right font-semibold tabular-nums text-ink"
                  >
                    {prefs.quietZone}px
                  </span>
                </div>
              </div>
            </div>

            {/* Download */}
            <div className="border-t-2 border-ink p-5 sm:p-6">
              <button
                type="button"
                className="wb-btn group w-full justify-center"
                disabled={!qrOutput}
                onClick={handleDownload}
              >
                Download {prefs.format}
                <Download
                  className="h-4 w-4 transition-transform duration-200 ease-[cubic-bezier(0.22,1,0.36,1)] group-hover:translate-y-0.5"
                  aria-hidden="true"
                />
                <KbdHint>⌘S</KbdHint>
              </button>
            </div>
          </section>
        </div>

        {/* Preview */}
        <aside aria-label="Live QR preview" className="lg:col-span-5">
          <div className="lg:sticky lg:top-24">
            <section className="wb-panel wb-panel--out">
              <PaneHeader
                label="Live preview"
                className="bg-paper-2"
                trailing={
                  <span
                    key={qrError ? "err" : "ok"}
                    className={cn(
                      "wb-fade-in inline-flex items-center gap-1.5 rounded-md border-2 border-ink px-2 py-0.5",
                      "font-mono text-[10.5px] font-semibold uppercase tracking-[0.1em] text-ink",
                      qrError ? "bg-tomato" : "bg-mint",
                    )}
                  >
                    {!qrError && <span className="size-1.5 rounded-full bg-grass" aria-hidden />}
                    {qrError ? "ERROR" : "ACTIVE SYNC"}
                  </span>
                }
              />

              <div className="space-y-6 p-5 sm:p-8">
                <div
                  ref={previewRef}
                  className="relative rounded-lg border-2 border-ink bg-paper p-5"
                >
                  <div
                    key={`${prefs.format}|${qrError ? "err" : qrOutput ? "ok" : "empty"}`}
                    className="wb-fade-in flex aspect-square items-center justify-center"
                  >
                    {qrError ? (
                      <div
                        role="alert"
                        className="flex max-w-xs flex-col items-center gap-3 px-4 text-center"
                      >
                        <CircleAlert
                          className="size-7 text-tomato"
                          strokeWidth={2}
                          aria-hidden="true"
                        />
                        <p className="font-mono text-[13px] leading-relaxed text-ink">{qrError}</p>
                      </div>
                    ) : qrOutput && prefs.format === "SVG" ? (
                      <div
                        className="size-full [&>svg]:size-full"
                        // biome-ignore lint/security/noDangerouslySetInnerHtml: SVG output from qrcode library is trusted
                        dangerouslySetInnerHTML={{ __html: qrOutput }}
                      />
                    ) : qrOutput && prefs.format === "PNG" ? (
                      <img
                        src={qrOutput}
                        alt="Generated QR code"
                        className="size-full object-contain"
                      />
                    ) : (
                      <p className="px-6 text-center text-sm text-ink-3">
                        Enter content to generate QR code
                      </p>
                    )}
                  </div>
                </div>

                <div className="flex justify-center">
                  <span
                    className="inline-flex max-w-full items-center rounded-md border-2 border-ink bg-paper px-3 py-1 shadow-pop-1"
                    title={currentPayload || "No content"}
                  >
                    <span className="block max-w-[260px] truncate font-mono text-[12px] font-medium text-ink-2">
                      {currentPayload || "No content"}
                    </span>
                  </span>
                </div>

                <div className="flex items-center justify-center gap-1">
                  {canShare && (
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={handleShare}
                      disabled={!qrOutput}
                      className="size-11 rounded-full text-ink-3 hover:bg-paper hover:text-ink sm:size-10"
                      aria-label="Share QR code"
                    >
                      <Share2 className="h-4 w-4" />
                    </Button>
                  )}
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={handleCopy}
                    disabled={!qrOutput}
                    className="size-11 rounded-full text-ink-3 hover:bg-paper hover:text-ink sm:size-10"
                    aria-label="Copy QR code"
                  >
                    <IconSwap swapKey={copied}>
                      {copied ? (
                        <Check className="h-4 w-4 text-ink" />
                      ) : (
                        <Copy className="h-4 w-4" />
                      )}
                    </IconSwap>
                  </Button>
                  {canFullscreen && (
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={handleFullscreen}
                      disabled={!qrOutput}
                      className="size-11 rounded-full text-ink-3 hover:bg-paper hover:text-ink sm:size-10"
                      aria-label="Fullscreen preview"
                    >
                      <Maximize className="h-4 w-4" />
                    </Button>
                  )}
                </div>
              </div>
            </section>
          </div>
        </aside>
      </div>
    </ToolShell>
  );
}

interface ColorFieldProps {
  id: string;
  label: string;
  value: string;
  fallback: string;
  onChange: (value: string) => void;
  pickerRef: React.RefObject<HTMLInputElement | null>;
  ariaLabel: string;
}

function ColorField({
  id,
  label,
  value,
  fallback,
  onChange,
  pickerRef,
  ariaLabel,
}: ColorFieldProps) {
  const valid = isValidHexColor(value);
  const swatchColor = valid ? value : fallback;
  return (
    <div className="space-y-2">
      <Label htmlFor={id} className={metaLabelCls}>
        {label}
      </Label>
      <div
        className={cn(
          "flex min-h-11 items-center gap-2 rounded-md border-2 bg-paper px-2.5 py-1.5 transition-colors sm:min-h-0",
          "focus-within:ring-2 focus-within:ring-tomato focus-within:ring-offset-2 focus-within:ring-offset-paper",
          valid ? "border-ink" : "border-destructive ring-2 ring-destructive/50",
        )}
      >
        <input
          ref={pickerRef}
          type="color"
          value={swatchColor}
          onChange={(e) => onChange(e.target.value.toUpperCase())}
          className="sr-only"
          aria-hidden="true"
          tabIndex={-1}
        />
        <button
          type="button"
          onClick={() => pickerRef.current?.click()}
          className="grid size-11 shrink-0 place-items-center rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-tomato focus-visible:ring-offset-2 focus-visible:ring-offset-paper sm:size-7"
          aria-label={ariaLabel}
        >
          <span
            className="size-6 rounded-sm border-2 border-ink transition-transform hover:scale-105"
            style={{ backgroundColor: swatchColor }}
            aria-hidden="true"
          />
        </button>
        <input
          id={id}
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          spellCheck={false}
          autoCorrect="off"
          autoCapitalize="characters"
          className="w-full border-none bg-transparent p-0 font-mono text-sm uppercase text-ink outline-none focus:ring-0 placeholder:text-ink-3"
        />
      </div>
    </div>
  );
}
