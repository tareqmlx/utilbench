import { unzipSync, zipSync } from "fflate";

// --- Types ---

export interface LottieJSON {
  w: number;
  h: number;
  fr: number;
  ip: number;
  op: number;
  layers: unknown[];
  assets?: unknown[];
  v?: string;
  nm?: string;
  ddd?: number;
}

export interface LottieMetadata {
  filename: string;
  fileSize: number;
  width: number;
  height: number;
  frameRate: number;
  totalFrames: number;
  duration: number;
  version: string;
  animationName: string;
}

export type FeatureTag =
  | "shapes"
  | "gradients"
  | "masks"
  | "expressions"
  | "images"
  | "text"
  | "3d"
  | "trim-paths"
  | "repeaters"
  | "effects";

export interface DetectedFeature {
  tag: FeatureTag;
  label: string;
  level: "info" | "warning";
}

export interface ValidationResult {
  valid: boolean;
  error?: string;
  warning?: string;
}

// --- Constants ---

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB
const WARN_FILE_SIZE = 5 * 1024 * 1024; // 5MB
const ACCEPTED_EXTENSIONS = [".json", ".lottie"];

// --- Validation & Parsing ---

export function validateFile(file: File): ValidationResult {
  const ext = file.name.toLowerCase().slice(file.name.lastIndexOf("."));
  if (!ACCEPTED_EXTENSIONS.includes(ext)) {
    return { valid: false, error: "Invalid file type. Please upload a .json or .lottie file." };
  }
  if (file.size > MAX_FILE_SIZE) {
    return { valid: false, error: "File too large. Maximum size is 10MB." };
  }
  if (file.size > WARN_FILE_SIZE) {
    return { valid: true, warning: "Large file detected. Processing may be slow on some devices." };
  }
  return { valid: true };
}

export function parseLottieJson(text: string): LottieJSON {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error("Invalid JSON format.");
  }

  const obj = data as Record<string, unknown>;
  if (
    typeof obj.w !== "number" ||
    typeof obj.h !== "number" ||
    typeof obj.fr !== "number" ||
    typeof obj.ip !== "number" ||
    typeof obj.op !== "number" ||
    !Array.isArray(obj.layers)
  ) {
    throw new Error(
      "Not a valid Lottie animation. Missing required fields (w, h, fr, ip, op, layers).",
    );
  }

  return obj as unknown as LottieJSON;
}

export function parseDotLottie(data: ArrayBuffer | Uint8Array): LottieJSON {
  const input = data instanceof Uint8Array ? data : new Uint8Array(data);
  let files: ReturnType<typeof unzipSync>;
  try {
    files = unzipSync(input);
  } catch {
    throw new Error("Failed to decompress .lottie file.");
  }

  const decoder = new TextDecoder();

  // Try manifest.json first
  const manifestData = files["manifest.json"];
  if (manifestData) {
    try {
      const manifest = JSON.parse(decoder.decode(manifestData)) as {
        animations?: { id: string }[];
      };
      const firstId = manifest.animations?.[0]?.id;
      if (firstId) {
        const animPath = `animations/${firstId}.json`;
        const animData = files[animPath];
        if (animData) {
          return parseLottieJson(decoder.decode(animData));
        }
      }
    } catch {
      // Fall through to search
    }
  }

  // Fallback: find any .json file
  for (const [path, data] of Object.entries(files)) {
    if (path.endsWith(".json") && path !== "manifest.json") {
      try {
        return parseLottieJson(decoder.decode(data));
      } catch {
        // Try next
      }
    }
  }

  throw new Error("No valid Lottie animation found in .lottie file.");
}

export async function parseFile(file: File): Promise<LottieJSON> {
  const ext = file.name.toLowerCase().slice(file.name.lastIndexOf("."));
  if (ext === ".lottie") {
    const buffer = await file.arrayBuffer();
    return parseDotLottie(buffer);
  }
  const text = await file.text();
  return parseLottieJson(text);
}

// --- Metadata ---

export function extractMetadata(json: LottieJSON, file: File): LottieMetadata {
  const totalFrames = json.op - json.ip;
  const duration = totalFrames / json.fr;
  return {
    filename: file.name,
    fileSize: file.size,
    width: json.w,
    height: json.h,
    frameRate: json.fr,
    totalFrames,
    duration,
    version: json.v ?? "Unknown",
    animationName: json.nm ?? "Untitled",
  };
}

// --- Feature Detection ---

const FEATURE_MAP: {
  tag: FeatureTag;
  label: string;
  level: "info" | "warning";
  check: (json: string) => boolean;
}[] = [
  {
    tag: "shapes",
    label: "Shapes",
    level: "info",
    check: (s) =>
      s.includes('"ty":"sh"') ||
      s.includes('"ty":"rc"') ||
      s.includes('"ty":"el"') ||
      s.includes('"ty":"sr"'),
  },
  {
    tag: "gradients",
    label: "Gradients",
    level: "info",
    check: (s) => s.includes('"ty":"gf"') || s.includes('"ty":"gs"'),
  },
  {
    tag: "masks",
    label: "Masks",
    level: "info",
    check: (s) => s.includes('"masksProperties"') || s.includes('"hasMask":true'),
  },
  {
    tag: "expressions",
    label: "Expressions",
    level: "warning",
    check: (s) => s.includes('"x"') && s.includes('"ix"'),
  },
  {
    tag: "images",
    label: "Images",
    level: "info",
    check: (s) => s.includes('"ty":"im"') || s.includes('"e":1'),
  },
  { tag: "text", label: "Text Layers", level: "info", check: (s) => s.includes('"ty":5') },
  { tag: "3d", label: "3D Layers", level: "warning", check: (s) => s.includes('"ddd":1') },
  { tag: "trim-paths", label: "Trim Paths", level: "info", check: (s) => s.includes('"ty":"tm"') },
  { tag: "repeaters", label: "Repeaters", level: "info", check: (s) => s.includes('"ty":"rp"') },
  { tag: "effects", label: "Effects", level: "warning", check: (s) => s.includes('"ef":[') },
];

export function detectFeatures(json: LottieJSON): DetectedFeature[] {
  const serialized = JSON.stringify(json);
  const features: DetectedFeature[] = [];

  for (const rule of FEATURE_MAP) {
    if (rule.check(serialized)) {
      features.push({ tag: rule.tag, label: rule.label, level: rule.level });
    }
  }

  return features;
}

// --- Formatting ---

export function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "0:00";
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// --- Exports ---

export function buildDotLottie(json: LottieJSON): Blob {
  const manifest = {
    generator: "Utilbench Web",
    version: 1,
    animations: [{ id: "animation", speed: 1, loop: true }],
  };

  const encode = (s: string) => Uint8Array.from(new TextEncoder().encode(s));
  const files: Record<string, Uint8Array> = {
    "manifest.json": encode(JSON.stringify(manifest)),
    "animations/animation.json": encode(JSON.stringify(json)),
  };

  const zipped = zipSync(files);
  return new Blob([zipped], { type: "application/zip" });
}

export function generateEmbedCode(): string {
  return `<script src="https://unpkg.com/@lottiefiles/lottie-player@latest/dist/lottie-player.js"></script>
<lottie-player
  src="YOUR_ANIMATION_URL.json"
  background="transparent"
  speed="1"
  style="width: 300px; height: 300px"
  loop
  autoplay
></lottie-player>`;
}

export async function exportFrameAsPng(
  svgElement: SVGSVGElement,
  width: number,
  height: number,
): Promise<Blob> {
  const serializer = new XMLSerializer();
  const svgString = serializer.serializeToString(svgElement);
  const svgBlob = new Blob([svgString], { type: "image/svg+xml;charset=utf-8" });
  const url = URL.createObjectURL(svgBlob);

  try {
    const img = await loadImage(url);
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Failed to get canvas context");
    ctx.drawImage(img, 0, 0, width, height);

    return new Promise((resolve, reject) => {
      canvas.toBlob((blob) => {
        if (blob) resolve(blob);
        else reject(new Error("Failed to create PNG blob"));
      }, "image/png");
    });
  } finally {
    URL.revokeObjectURL(url);
  }
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Failed to load image"));
    img.src = src;
  });
}

export async function exportAsGif(
  container: HTMLElement,
  width: number,
  height: number,
  totalFrames: number,
  lottieInstance: { goToAndStop: (frame: number, isFrame: boolean) => void },
): Promise<Blob> {
  const { GIFEncoder, quantize, applyPalette } = await import("gifenc");
  const gif = GIFEncoder();

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Failed to get canvas context");

  for (let frame = 0; frame < totalFrames; frame++) {
    lottieInstance.goToAndStop(frame, true);

    // Wait for render
    await new Promise((r) => requestAnimationFrame(r));

    const svg = container.querySelector("svg");
    if (!svg) continue;

    const serializer = new XMLSerializer();
    const svgString = serializer.serializeToString(svg);
    const blob = new Blob([svgString], { type: "image/svg+xml;charset=utf-8" });
    const url = URL.createObjectURL(blob);

    try {
      const img = await loadImage(url);
      ctx.clearRect(0, 0, width, height);
      ctx.drawImage(img, 0, 0, width, height);
    } finally {
      URL.revokeObjectURL(url);
    }

    const imageData = ctx.getImageData(0, 0, width, height);
    const palette = quantize(imageData.data, 256);
    const index = applyPalette(imageData.data, palette);
    // ~33ms per frame for 30fps feel
    gif.writeFrame(index, width, height, { palette, delay: 33 });
  }

  gif.finish();
  return new Blob([gif.bytes()], { type: "image/gif" });
}
