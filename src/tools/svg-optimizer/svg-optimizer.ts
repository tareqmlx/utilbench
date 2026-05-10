import { zipSync } from "fflate";
import { optimize } from "svgo/browser";

export interface SvgOptimizerOptions {
  removeComments: boolean;
  removeMetadata: boolean;
  simplifyPaths: boolean;
  removeUnusedIds: boolean;
  prefixIds: boolean;
  convertColorsToHex: boolean;
}

export type PresetName = "ui-icons" | "mobile" | "print" | "legacy";
export type FileStatus = "pending" | "processing" | "done" | "error";

export interface QueuedFile {
  id: string;
  name: string;
  originalContent: string;
  originalSize: number;
  optimizedContent: string | null;
  optimizedSize: number | null;
  status: FileStatus;
  error: string | null;
  downloaded: boolean;
}

export const DEFAULT_OPTIONS: SvgOptimizerOptions = {
  removeComments: true,
  removeMetadata: true,
  simplifyPaths: true,
  removeUnusedIds: true,
  prefixIds: false,
  convertColorsToHex: true,
};

export const PRESET_CONFIGS: Record<PresetName, SvgOptimizerOptions> = {
  "ui-icons": {
    removeComments: true,
    removeMetadata: true,
    simplifyPaths: true,
    removeUnusedIds: true,
    prefixIds: true,
    convertColorsToHex: true,
  },
  mobile: {
    removeComments: true,
    removeMetadata: true,
    simplifyPaths: true,
    removeUnusedIds: true,
    prefixIds: false,
    convertColorsToHex: true,
  },
  print: {
    removeComments: true,
    removeMetadata: false,
    simplifyPaths: false,
    removeUnusedIds: false,
    prefixIds: false,
    convertColorsToHex: false,
  },
  legacy: {
    removeComments: true,
    removeMetadata: true,
    simplifyPaths: false,
    removeUnusedIds: false,
    prefixIds: false,
    convertColorsToHex: false,
  },
};

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB
const WARN_FILE_SIZE = 5 * 1024 * 1024; // 5MB

export interface ValidationResult {
  valid: boolean;
  error?: string;
  warning?: string;
}

export function validateSvgContent(content: string): ValidationResult {
  const trimmed = content.trim();
  if (!trimmed) {
    return { valid: false, error: "Empty content provided." };
  }

  const parser = new DOMParser();
  const doc = parser.parseFromString(trimmed, "image/svg+xml");
  const parseError = doc.querySelector("parsererror");
  if (parseError) {
    return { valid: false, error: "Invalid XML content." };
  }

  if (!doc.querySelector("svg")) {
    return { valid: false, error: "No <svg> element found." };
  }

  return { valid: true };
}

export function validateSvgFile(file: File): ValidationResult {
  const validTypes = ["image/svg+xml"];
  const validExtension = file.name.toLowerCase().endsWith(".svg");

  if (!validTypes.includes(file.type) && !validExtension) {
    return { valid: false, error: "Invalid file type. Please upload an SVG file." };
  }

  if (file.size > MAX_FILE_SIZE) {
    return { valid: false, error: "File too large. Maximum size is 10MB." };
  }
  if (file.size > WARN_FILE_SIZE) {
    return { valid: true, warning: "Large file detected. Processing may be slow on some devices." };
  }

  return { valid: true };
}

export function optimizeSvg(content: string, options: SvgOptimizerOptions): string {
  const overrides: Record<string, boolean> = {};

  if (!options.removeComments) overrides.removeComments = false;
  if (!options.removeMetadata) overrides.removeMetadata = false;
  if (!options.simplifyPaths) overrides.convertPathData = false;
  if (!options.removeUnusedIds) overrides.cleanupIds = false;
  if (!options.convertColorsToHex) overrides.convertColors = false;

  const plugins: Array<{ name: string; params?: Record<string, unknown> }> = [
    { name: "preset-default", params: { overrides } },
  ];

  if (options.prefixIds) {
    plugins.push({ name: "prefixIds" });
  }

  const result = optimize(content, {
    multipass: true,
    plugins,
  });

  return result.data;
}

export function createSvgBlob(content: string): Blob {
  return new Blob([content], { type: "image/svg+xml" });
}

export function createZipBlob(files: Array<{ name: string; content: string }>): Blob {
  const entries: Record<string, Uint8Array> = {};
  for (const file of files) {
    entries[file.name] = new TextEncoder().encode(file.content);
  }
  const zipped = zipSync(entries);
  return new Blob([zipped], { type: "application/zip" });
}

export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(1)} KB`;
  const mb = kb / 1024;
  return `${mb.toFixed(1)} MB`;
}

export function calculateReduction(original: number, optimized: number): number {
  if (original === 0) return 0;
  return Math.round(((original - optimized) / original) * 100);
}
