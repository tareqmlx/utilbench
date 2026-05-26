import { Check, Copy, Download, Link2, Maximize, Share2, Type, Wifi } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { IconSwap } from "../../components/IconSwap";
import { KbdHint } from "../../components/KbdHint";
import { ToolShell } from "../../components/tool-layout";
import { Alert, AlertDescription } from "../../components/ui/alert";
import { Button } from "../../components/ui/button";
import { Card, CardContent } from "../../components/ui/card";
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

const trustedAvatars = ["bg-muted", "bg-muted/80", "bg-muted/60"] as const;

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
      setQrError(err instanceof Error ? err.message : "Failed to generate QR code");
      setQrOutput(null);
    }
  }, [prefs, activeContentType, textInput, wifiSsid, wifiPassword, vcardName, vcardOrg]);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(generate, 250);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [generate]);

  const currentPayload = buildPayload(activeContentType, {
    textInput,
    wifiSsid,
    wifiPassword,
    vcardName,
    vcardOrg,
  });

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

  return (
    <ToolShell>
      <div className="grid grid-cols-1 gap-12 lg:grid-cols-12">
        <div className="space-y-8 lg:col-span-7">
          <Card className="p-4 sm:p-8">
            <CardContent className="space-y-6 p-0">
              <div className="space-y-2">
                <Tabs
                  value={activeContentType}
                  onValueChange={(v) => {
                    setPrefs({ contentType: v as ContentType });
                    setUrlState({ type: v });
                  }}
                >
                  <div className="mb-4 flex items-center justify-between border-b border-border pb-2">
                    <span className="text-sm font-bold uppercase tracking-widest text-muted-foreground">
                      Content Type
                    </span>
                    <TabsList className="h-auto bg-transparent p-0">
                      {contentTabs.map((tab) => (
                        <TabsTrigger
                          key={tab}
                          value={tab}
                          className="rounded-none border-b-2 border-transparent px-2 py-1 text-[10px] font-bold uppercase tracking-wider shadow-none data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:text-primary data-[state=active]:shadow-none"
                        >
                          {tab}
                        </TabsTrigger>
                      ))}
                    </TabsList>
                  </div>
                </Tabs>

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
                      className="h-14 pr-12 text-lg"
                    />
                    <div className="absolute top-1/2 right-4 -translate-y-1/2 text-muted-foreground">
                      {(() => {
                        const IconComp = contentIcons[activeContentType];
                        return <IconComp className="h-5 w-5" />;
                      })()}
                    </div>
                  </div>
                )}

                {activeContentType === "WiFi" && (
                  <div className="wb-fade-in grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label
                        htmlFor="qr-generator-network-ssid"
                        className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground"
                      >
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
                      <Label
                        htmlFor="qr-generator-network-password"
                        className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground"
                      >
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
                  <div className="wb-fade-in grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label
                        htmlFor="qr-generator-full-name"
                        className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground"
                      >
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
                      <Label
                        htmlFor="qr-generator-organization"
                        className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground"
                      >
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

              <div className="grid grid-cols-1 gap-6 border-t border-border pt-4 md:grid-cols-3">
                <div className="space-y-2">
                  <Label className="text-xs font-bold uppercase tracking-widest text-muted-foreground">
                    Size
                  </Label>
                  <Select
                    value={String(prefs.size)}
                    onValueChange={(v) => setPrefs({ size: Number(v) })}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="256">256 x 256 px</SelectItem>
                      <SelectItem value="512">512 x 512 px</SelectItem>
                      <SelectItem value="1024">1024 x 1024 px</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label className="text-xs font-bold uppercase tracking-widest text-muted-foreground">
                    Correction
                  </Label>
                  <Select
                    value={prefs.errorCorrection}
                    onValueChange={(v) => setPrefs({ errorCorrection: v as "L" | "M" | "Q" | "H" })}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="L">Low (7%)</SelectItem>
                      <SelectItem value="M">Medium (15%)</SelectItem>
                      <SelectItem value="Q">High (25%)</SelectItem>
                      <SelectItem value="H">Ultra (30%)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <span className="text-xs font-bold uppercase tracking-widest text-muted-foreground">
                    Format
                  </span>
                  <Tabs
                    value={prefs.format}
                    onValueChange={(v) => setPrefs({ format: v as "SVG" | "PNG" })}
                  >
                    <TabsList className="w-full">
                      {formatTabs.map((tab) => (
                        <TabsTrigger key={tab} value={tab} className="flex-1 text-xs font-bold">
                          {tab}
                        </TabsTrigger>
                      ))}
                    </TabsList>
                  </Tabs>
                </div>
              </div>

              <div className="grid grid-cols-1 gap-6 border-t border-border pt-6 md:grid-cols-3">
                <div className="space-y-2">
                  <Label
                    htmlFor="qr-generator-foreground"
                    className="text-xs font-bold uppercase tracking-widest text-muted-foreground"
                  >
                    Foreground
                  </Label>
                  <div
                    className={`flex items-center gap-2 rounded-md border bg-background p-2 ${
                      !isValidHexColor(prefs.foregroundColor)
                        ? "border-destructive ring-2 ring-destructive/50"
                        : "border-input"
                    }`}
                  >
                    <input
                      ref={fgPickerRef}
                      type="color"
                      value={
                        isValidHexColor(prefs.foregroundColor) ? prefs.foregroundColor : "#1f1a14"
                      }
                      onChange={(e) => handleForegroundChange(e.target.value.toUpperCase())}
                      className="sr-only"
                      aria-hidden="true"
                      tabIndex={-1}
                    />
                    <button
                      type="button"
                      onClick={() => fgPickerRef.current?.click()}
                      className="size-6 shrink-0 rounded-sm border border-input"
                      style={{
                        backgroundColor: isValidHexColor(prefs.foregroundColor)
                          ? prefs.foregroundColor
                          : "#1f1a14",
                      }}
                      aria-label="Pick foreground color"
                    />
                    <input
                      id="qr-generator-foreground"
                      type="text"
                      value={prefs.foregroundColor}
                      onChange={(e) => handleForegroundChange(e.target.value)}
                      className="w-full border-none bg-transparent p-0 font-mono text-sm outline-none focus:ring-0"
                    />
                  </div>
                </div>

                <div className="space-y-2">
                  <Label
                    htmlFor="qr-generator-background"
                    className="text-xs font-bold uppercase tracking-widest text-muted-foreground"
                  >
                    Background
                  </Label>
                  <div
                    className={`flex items-center gap-2 rounded-md border bg-background p-2 ${
                      !isValidHexColor(prefs.backgroundColor)
                        ? "border-destructive ring-2 ring-destructive/50"
                        : "border-input"
                    }`}
                  >
                    <input
                      ref={bgPickerRef}
                      type="color"
                      value={
                        isValidHexColor(prefs.backgroundColor) ? prefs.backgroundColor : "#fff7ec"
                      }
                      onChange={(e) => handleBackgroundChange(e.target.value.toUpperCase())}
                      className="sr-only"
                      aria-hidden="true"
                      tabIndex={-1}
                    />
                    <button
                      type="button"
                      onClick={() => bgPickerRef.current?.click()}
                      className="size-6 shrink-0 rounded-sm border border-input"
                      style={{
                        backgroundColor: isValidHexColor(prefs.backgroundColor)
                          ? prefs.backgroundColor
                          : "#fff7ec",
                      }}
                      aria-label="Pick background color"
                    />
                    <input
                      id="qr-generator-background"
                      type="text"
                      value={prefs.backgroundColor}
                      onChange={(e) => handleBackgroundChange(e.target.value)}
                      className="w-full border-none bg-transparent p-0 font-mono text-sm outline-none focus:ring-0"
                    />
                  </div>
                </div>

                <div className="space-y-2">
                  <Label
                    htmlFor="qr-generator-quiet-zone"
                    className="text-xs font-bold uppercase tracking-widest text-muted-foreground"
                  >
                    Quiet Zone
                  </Label>
                  <div className="flex h-10.5 items-center gap-4">
                    <Slider
                      id="qr-generator-quiet-zone"
                      min={0}
                      max={10}
                      step={1}
                      value={[prefs.quietZone]}
                      onValueChange={([v]) => setPrefs({ quietZone: v })}
                      className="flex-1"
                    />
                    <span className="font-mono text-xs font-bold text-muted-foreground">
                      {prefs.quietZone}px
                    </span>
                  </div>
                </div>
              </div>

              <div className="pt-6">
                <Button
                  className="group w-full py-4 font-bold"
                  size="lg"
                  disabled={!qrOutput}
                  onClick={handleDownload}
                >
                  Download {prefs.format}
                  <Download className="h-4 w-4 transition-transform group-hover:translate-y-0.5" />
                  <KbdHint>⌘S</KbdHint>
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>

        <div className="flex flex-col items-center justify-center lg:col-span-5">
          <Card className="group relative w-full max-w-sm overflow-hidden p-4 shadow-pop-3 sm:p-8">
            <div className="absolute inset-0 bg-primary/5 opacity-0 transition-opacity group-hover:opacity-100" />

            <div className="relative z-10 flex flex-col items-center">
              <p className="mb-6 text-[10px] font-bold uppercase tracking-[0.2em] text-primary">
                Real-Time Preview
              </p>

              <div
                ref={previewRef}
                className="relative flex aspect-square w-full items-center justify-center rounded-lg border-4 border-muted bg-muted p-6"
              >
                <div className="flex h-full w-full items-center justify-center overflow-hidden rounded bg-paper p-2">
                  {qrError ? (
                    <p className="px-4 text-center text-sm text-destructive">{qrError}</p>
                  ) : qrOutput && prefs.format === "SVG" ? (
                    <div
                      className="h-full w-full [&>svg]:h-full [&>svg]:w-full"
                      // biome-ignore lint/security/noDangerouslySetInnerHtml: SVG output from qrcode library is trusted
                      dangerouslySetInnerHTML={{ __html: qrOutput }}
                    />
                  ) : qrOutput && prefs.format === "PNG" ? (
                    <img
                      src={qrOutput}
                      alt="Generated QR code"
                      className="h-full w-full object-contain"
                    />
                  ) : (
                    <p className="text-sm text-muted-foreground">
                      Enter content to generate QR code
                    </p>
                  )}
                </div>

                <div
                  className={`absolute -bottom-3 rounded-full border-2 border-ink px-3 py-1 text-[10px] font-bold text-paper shadow-pop-1 ${
                    qrError ? "bg-tomato" : "bg-grass"
                  }`}
                >
                  {qrError ? "ERROR" : "ACTIVE SYNC"}
                </div>
              </div>

              <div className="mt-8 space-y-2 text-center">
                <p className="max-w-50 truncate text-sm font-semibold">
                  {currentPayload || "No content"}
                </p>
                <div className="flex justify-center gap-2">
                  {canShare && (
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={handleShare}
                      disabled={!qrOutput}
                      className="rounded-full"
                      aria-label="Share QR code"
                    >
                      <Share2 className="h-4 w-4 text-muted-foreground" />
                    </Button>
                  )}
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={handleCopy}
                    disabled={!qrOutput}
                    className="rounded-full"
                    aria-label="Copy QR code"
                  >
                    <IconSwap swapKey={copied}>
                      {copied ? (
                        <Check className="h-4 w-4 text-muted-foreground" />
                      ) : (
                        <Copy className="h-4 w-4 text-muted-foreground" />
                      )}
                    </IconSwap>
                  </Button>
                  {canFullscreen && (
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={handleFullscreen}
                      disabled={!qrOutput}
                      className="rounded-full"
                      aria-label="Fullscreen preview"
                    >
                      <Maximize className="h-4 w-4 text-muted-foreground" />
                    </Button>
                  )}
                </div>
              </div>
            </div>
          </Card>

          <div className="mt-8 flex flex-col items-center gap-2">
            <div className="flex -space-x-2">
              {trustedAvatars.map((avatar) => (
                <div
                  key={avatar}
                  className={`size-8 rounded-full border-2 border-background ${avatar}`}
                />
              ))}
              <div className="flex size-8 items-center justify-center rounded-full border-2 border-background bg-primary text-[10px] leading-none font-bold text-primary-foreground">
                +12k
              </div>
            </div>
            <p className="text-xs font-medium text-muted-foreground">
              Trusted by creators worldwide
            </p>
          </div>
        </div>
      </div>
    </ToolShell>
  );
}
