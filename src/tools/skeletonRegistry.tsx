import type { ComponentType } from "react";
import {
  SkeletonBlock,
  SkeletonButton,
  SkeletonLine,
  SkeletonTextArea,
} from "../components/skeleton";
import { ToolShell } from "../components/tool-layout";
import type { ToolDefinition } from "./types";

export interface SkeletonProps {
  tool: ToolDefinition;
}

/** Generate stable string keys for static skeleton lists. */
const sk = (n: number) => Array.from({ length: n }, (_, i) => `sk${i}`);

/* ── 1. QR Generator ─────────────────────────────────────── */

function QrGeneratorSkeleton() {
  return (
    <ToolShell>
      <div className="grid grid-cols-1 gap-12 lg:grid-cols-12">
        <div className="space-y-6 lg:col-span-7">
          <div className="flex gap-2">
            <SkeletonButton width="w-20" />
            <SkeletonButton width="w-20" />
            <SkeletonButton width="w-20" />
          </div>
          <SkeletonTextArea className="h-28" />
          <div className="grid grid-cols-3 gap-4">
            <SkeletonBlock className="h-20" />
            <SkeletonBlock className="h-20" />
            <SkeletonBlock className="h-20" />
          </div>
          <SkeletonButton width="w-full" />
        </div>
        <div className="space-y-4 lg:col-span-5">
          <SkeletonBlock className="aspect-square rounded-xl" />
          <div className="flex gap-3">
            <SkeletonButton width="w-1/2" />
            <SkeletonButton width="w-1/2" />
          </div>
        </div>
      </div>
    </ToolShell>
  );
}

/* ── 2. Image Metadata Removal ───────────────────────────── */

function ImageMetadataRemovalSkeleton() {
  return (
    <ToolShell>
      <div className="grid items-center gap-12 lg:grid-cols-2">
        <SkeletonBlock className="aspect-video rounded-xl" />
      </div>
      <div className="mt-12 rounded-xl border-2 border-dashed border-border p-12">
        <div className="flex flex-col items-center gap-4">
          <SkeletonBlock className="size-16 rounded-full" />
          <SkeletonLine width="w-48" height="h-5" />
          <SkeletonLine width="w-64" height="h-4" />
        </div>
      </div>
    </ToolShell>
  );
}

/* ── 3. Base64 Encoder ───────────────────────────────────── */

function Base64EncoderSkeleton() {
  return (
    <ToolShell>
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <div className="rounded-xl border border-border p-5">
          <SkeletonLine width="w-16" height="h-4" className="mb-3" />
          <div className="mb-4 flex gap-2">
            <SkeletonButton width="w-24" />
            <SkeletonButton width="w-24" />
          </div>
          <SkeletonTextArea className="h-80" />
          <SkeletonButton width="w-20" className="mt-3" />
        </div>
        <div className="rounded-xl border border-border p-5">
          <SkeletonLine width="w-16" height="h-4" className="mb-3" />
          <SkeletonTextArea className="h-80" />
          <SkeletonButton width="w-20" className="mt-3" />
        </div>
      </div>
    </ToolShell>
  );
}

/* ── 4. Case Converter ───────────────────────────────────── */

function CaseConverterSkeleton() {
  return (
    <ToolShell>
      <div className="grid grid-cols-1 gap-8">
        <div>
          <SkeletonLine width="w-20" height="h-4" className="mb-2" />
          <SkeletonTextArea className="min-h-[200px]" />
        </div>
        <div className="flex flex-wrap gap-2">
          {sk(7).map((key) => (
            <SkeletonButton key={key} width="w-28" />
          ))}
        </div>
        <div>
          <SkeletonLine width="w-20" height="h-4" className="mb-2" />
          <SkeletonTextArea className="min-h-[200px]" />
        </div>
      </div>
    </ToolShell>
  );
}

/* ── 5. JSON Formatter ───────────────────────────────────── */

function JsonFormatterSkeleton() {
  return (
    <ToolShell>
      <div className="grid min-h-125 grid-cols-1 gap-6 lg:grid-cols-2">
        <div className="flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <SkeletonLine width="w-16" height="h-4" />
            <div className="flex gap-2">
              <SkeletonButton width="w-16" />
              <SkeletonButton width="w-16" />
            </div>
          </div>
          <SkeletonTextArea className="flex-1" />
        </div>
        <div className="flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <SkeletonLine width="w-16" height="h-4" />
            <SkeletonButton width="w-16" />
          </div>
          <SkeletonTextArea className="flex-1" />
        </div>
      </div>
      <div className="mt-6 flex justify-center gap-4">
        <SkeletonButton width="w-36" />
        <SkeletonButton width="w-28" />
      </div>
    </ToolShell>
  );
}

/* ── 6. Cron Parser ──────────────────────────────────────── */

function CronParserSkeleton() {
  return (
    <ToolShell>
      <div className="space-y-12">
        <div className="grid grid-cols-1 gap-10 lg:grid-cols-12">
          <div className="space-y-6 lg:col-span-7">
            <SkeletonBlock className="h-14 rounded-xl" />
            <SkeletonBlock className="h-20 rounded-xl" />
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              {sk(6).map((key) => (
                <SkeletonButton key={key} width="w-full" />
              ))}
            </div>
          </div>
          <div className="lg:col-span-5">
            <div className="rounded-xl bg-card p-6">
              <SkeletonLine width="w-32" height="h-5" className="mb-5" />
              <div className="space-y-4">
                {sk(5).map((key) => (
                  <SkeletonLine key={key} width="w-full" height="h-4" />
                ))}
              </div>
              <SkeletonLine width="w-40" height="h-3" className="mt-5" />
            </div>
          </div>
        </div>
      </div>
    </ToolShell>
  );
}

/* ── 7. CSV to JSON ──────────────────────────────────────── */

function CsvToJsonSkeleton() {
  return (
    <ToolShell>
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <SkeletonLine width="w-24" height="h-5" />
            <div className="flex gap-2">
              <SkeletonButton width="w-24" />
              <SkeletonButton width="w-20" />
            </div>
          </div>
          <SkeletonTextArea className="h-96" />
          <SkeletonButton width="w-full" />
        </div>
        <div className="space-y-4">
          <SkeletonLine width="w-24" height="h-5" />
          <SkeletonBlock className="h-96 rounded-lg bg-muted" />
        </div>
      </div>
    </ToolShell>
  );
}

/* ── 8. JSON Schema Generator ────────────────────────────── */

function JsonSchemaGeneratorSkeleton() {
  return (
    <ToolShell>
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <div className="space-y-4">
          <SkeletonLine width="w-24" height="h-5" />
          <SkeletonTextArea className="h-96" />
          <div className="rounded-lg border border-border p-4">
            <SkeletonLine width="w-20" height="h-4" className="mb-3" />
            <div className="space-y-3">
              <SkeletonLine width="w-48" height="h-4" />
              <SkeletonLine width="w-40" height="h-4" />
              <SkeletonLine width="w-44" height="h-4" />
            </div>
          </div>
        </div>
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <SkeletonLine width="w-24" height="h-5" />
            <div className="flex gap-2">
              <SkeletonButton width="w-16" />
              <SkeletonButton width="w-20" />
            </div>
          </div>
          <SkeletonBlock className="h-96 rounded-lg bg-muted" />
        </div>
      </div>
    </ToolShell>
  );
}

/* ── 9. JWT Decoder ──────────────────────────────────────── */

function JwtDecoderSkeleton() {
  return (
    <ToolShell variant="wide">
      <div className="grid grid-cols-1 gap-8 lg:grid-cols-12">
        <div className="space-y-4 lg:col-span-5">
          <SkeletonLine width="w-24" height="h-5" />
          <SkeletonTextArea className="h-125" />
          <SkeletonLine width="w-32" height="h-6" className="rounded-full" />
        </div>
        <div className="space-y-6 lg:col-span-7">
          <div className="rounded-lg border-l-4 border-red-400 bg-red-50 p-4 dark:bg-red-950/30">
            <SkeletonLine width="w-20" height="h-5" className="mb-3 !bg-red-200 dark:!bg-red-800" />
            <SkeletonBlock className="h-24 !bg-red-100 dark:!bg-red-900/30" />
          </div>
          <div className="rounded-lg border-l-4 border-purple-400 bg-purple-50 p-4 dark:bg-purple-950/30">
            <SkeletonLine
              width="w-20"
              height="h-5"
              className="mb-3 !bg-purple-200 dark:!bg-purple-800"
            />
            <SkeletonBlock className="h-40 !bg-purple-100 dark:!bg-purple-900/30" />
          </div>
          <div className="rounded-lg border-l-4 border-cyan-400 bg-cyan-50 p-4 dark:bg-cyan-950/30">
            <SkeletonLine
              width="w-24"
              height="h-5"
              className="mb-3 !bg-cyan-200 dark:!bg-cyan-800"
            />
            <SkeletonBlock className="h-16 !bg-cyan-100 dark:!bg-cyan-900/30" />
          </div>
        </div>
      </div>
    </ToolShell>
  );
}

/* ── 10. Lottie Previewer ────────────────────────────────── */

function LottiePreviewerSkeleton() {
  return (
    <ToolShell>
      <div className="mb-8 rounded-xl border-2 border-dashed border-border p-8">
        <div className="flex flex-col items-center gap-3">
          <SkeletonBlock className="size-12 rounded-full" />
          <SkeletonLine width="w-48" height="h-5" />
          <SkeletonLine width="w-64" height="h-4" />
        </div>
      </div>
      <div className="grid grid-cols-1 gap-8 lg:grid-cols-12">
        <div className="space-y-4 lg:col-span-8">
          <SkeletonBlock className="aspect-video rounded-xl" />
          <SkeletonBlock className="h-2 rounded-full" />
          <div className="flex items-center justify-center gap-3">
            <SkeletonButton width="w-10" />
            <SkeletonButton width="w-10" />
            <SkeletonButton width="w-10" />
            <SkeletonButton width="w-10" />
          </div>
        </div>
        <div className="space-y-4 lg:col-span-4">
          <div className="rounded-lg border border-border p-4">
            <SkeletonLine width="w-24" height="h-5" className="mb-3" />
            <div className="space-y-2">
              {sk(4).map((key) => (
                <div key={key} className="flex justify-between">
                  <SkeletonLine width="w-16" height="h-3" />
                  <SkeletonLine width="w-20" height="h-3" />
                </div>
              ))}
            </div>
          </div>
          <div className="rounded-lg border border-border p-4">
            <SkeletonLine width="w-20" height="h-5" className="mb-3" />
            <div className="flex flex-wrap gap-2">
              {sk(4).map((key) => (
                <SkeletonLine key={key} width="w-16" height="h-6" className="rounded-full" />
              ))}
            </div>
          </div>
          <div className="rounded-lg border border-border p-4">
            <SkeletonLine width="w-20" height="h-5" className="mb-3" />
            <div className="space-y-2">
              <SkeletonButton width="w-full" />
              <SkeletonButton width="w-full" />
            </div>
          </div>
        </div>
      </div>
    </ToolShell>
  );
}

/* ── 11. Lorem Ipsum ─────────────────────────────────────── */

function LoremIpsumSkeleton() {
  return (
    <ToolShell>
      <div className="grid grid-cols-1 gap-8 lg:grid-cols-12">
        <div className="lg:col-span-4">
          <div className="rounded-xl border border-border p-5">
            <SkeletonLine width="w-32" height="h-5" className="mb-5" />
            <div className="space-y-4">
              <SkeletonLine width="w-20" height="h-4" />
              <div className="flex gap-2">
                <SkeletonButton width="w-1/3" />
                <SkeletonButton width="w-1/3" />
                <SkeletonButton width="w-1/3" />
              </div>
              <SkeletonLine width="w-24" height="h-4" />
              <SkeletonBlock className="h-10 rounded-lg" />
              <SkeletonLine width="w-40" height="h-4" />
              <SkeletonLine width="w-36" height="h-4" />
              <SkeletonButton width="w-full" className="mt-2" />
            </div>
          </div>
        </div>
        <div className="lg:col-span-8">
          <div className="rounded-xl border border-border p-6">
            <div className="space-y-4">
              {sk(6).map((key) => (
                <div key={key} className="space-y-2">
                  <SkeletonLine width="w-full" height="h-3" />
                  <SkeletonLine width="w-11/12" height="h-3" />
                  <SkeletonLine width="w-4/5" height="h-3" />
                  <SkeletonLine width="w-full" height="h-3" />
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </ToolShell>
  );
}

/* ── 12. Markdown Preview ────────────────────────────────── */

function MarkdownPreviewSkeleton() {
  return (
    <ToolShell>
      <div className="mb-4 flex gap-2">
        <SkeletonButton width="w-24" />
        <SkeletonButton width="w-24" />
        <SkeletonButton width="w-20" />
        <SkeletonButton width="w-28" />
      </div>
      <div className="grid grid-cols-1 overflow-hidden rounded-xl border border-border lg:grid-cols-2">
        <div className="border-r border-border">
          <div className="border-b border-border px-4 py-2">
            <SkeletonLine width="w-20" height="h-4" />
          </div>
          <div className="h-[500px] p-4">
            <div className="space-y-3">
              {sk(12).map((key, i) => (
                <SkeletonLine
                  key={key}
                  width={i % 3 === 0 ? "w-full" : i % 3 === 1 ? "w-4/5" : "w-11/12"}
                  height="h-3"
                />
              ))}
            </div>
          </div>
        </div>
        <div>
          <div className="border-b border-border px-4 py-2">
            <SkeletonLine width="w-20" height="h-4" />
          </div>
          <div className="h-[500px] p-4">
            <div className="space-y-4">
              <SkeletonLine width="w-1/3" height="h-7" />
              <SkeletonLine width="w-full" height="h-3" />
              <SkeletonLine width="w-5/6" height="h-3" />
              <SkeletonLine width="w-2/3" height="h-3" />
              <SkeletonLine width="w-1/4" height="h-6" className="mt-4" />
              <SkeletonLine width="w-full" height="h-3" />
              <SkeletonLine width="w-3/4" height="h-3" />
            </div>
          </div>
        </div>
      </div>
    </ToolShell>
  );
}

/* ── 13. SVG Optimizer ───────────────────────────────────── */

function SvgOptimizerSkeleton() {
  return (
    <ToolShell>
      <div className="flex flex-col gap-6">
        <div className="rounded-xl border-2 border-dashed border-border p-12">
          <div className="flex flex-col items-center gap-4">
            <SkeletonBlock className="size-16 rounded-full" />
            <SkeletonLine width="w-48" height="h-5" />
            <SkeletonLine width="w-64" height="h-4" />
          </div>
        </div>
        <div className="flex gap-3">
          <SkeletonButton width="w-32" />
          <SkeletonButton width="w-32" />
        </div>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          {sk(3).map((key) => (
            <div key={key} className="rounded-lg border border-border p-4">
              <SkeletonLine width="w-28" height="h-5" className="mb-4" />
              <div className="space-y-3">
                <SkeletonLine width="w-40" height="h-4" />
                <SkeletonLine width="w-36" height="h-4" />
                <SkeletonLine width="w-44" height="h-4" />
              </div>
            </div>
          ))}
        </div>
      </div>
    </ToolShell>
  );
}

/* ── 14. Favicon Generator ───────────────────────────────── */

function FaviconGeneratorSkeleton() {
  return (
    <ToolShell>
      <div className="grid grid-cols-1 gap-10 lg:grid-cols-12">
        <div className="space-y-6 lg:col-span-7">
          <div className="rounded-xl border-2 border-dashed border-border p-10">
            <div className="flex flex-col items-center gap-3">
              <SkeletonBlock className="size-12 rounded-full" />
              <SkeletonLine width="w-48" height="h-5" />
              <SkeletonLine width="w-56" height="h-4" />
            </div>
          </div>
          <div className="rounded-xl border border-border p-6">
            <div className="grid grid-cols-2 gap-6">
              <div className="space-y-3">
                <SkeletonLine width="w-28" height="h-4" />
                <SkeletonBlock className="h-10 rounded-lg" />
              </div>
              <div className="space-y-3">
                <SkeletonLine width="w-28" height="h-4" />
                <SkeletonBlock className="h-10 rounded-lg" />
              </div>
              <div className="space-y-3">
                <SkeletonLine width="w-28" height="h-4" />
                <SkeletonBlock className="h-10 rounded-lg" />
              </div>
              <div className="space-y-3">
                <SkeletonLine width="w-28" height="h-4" />
                <SkeletonBlock className="h-10 rounded-lg" />
              </div>
            </div>
            <SkeletonButton width="w-full" className="mt-6" />
          </div>
        </div>
        <div className="lg:col-span-5">
          <div className="sticky top-24 rounded-xl border border-border p-6">
            <SkeletonLine width="w-24" height="h-5" className="mb-4" />
            <SkeletonBlock className="mb-4 h-10 rounded-t-lg" />
            <div className="flex items-center justify-center gap-6 py-6">
              <SkeletonBlock className="size-8" />
              <SkeletonBlock className="size-12" />
              <SkeletonBlock className="size-16" />
            </div>
            <div className="mt-4 flex flex-wrap justify-center gap-2">
              {sk(4).map((key) => (
                <SkeletonLine key={key} width="w-16" height="h-6" className="rounded-full" />
              ))}
            </div>
          </div>
        </div>
      </div>
    </ToolShell>
  );
}

/* ── 15. Diff Checker ────────────────────────────────────── */

function DiffCheckerSkeleton() {
  return (
    <ToolShell variant="wide">
      <div className="flex flex-col gap-8">
        <div className="flex gap-2">
          <SkeletonButton width="w-24" />
          <SkeletonButton width="w-24" />
          <SkeletonButton width="w-24" />
        </div>
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <div className="space-y-3">
            <SkeletonLine width="w-24" height="h-5" />
            <SkeletonTextArea className="h-80" />
          </div>
          <div className="space-y-3">
            <SkeletonLine width="w-24" height="h-5" />
            <SkeletonTextArea className="h-80" />
          </div>
        </div>
        <div className="flex items-center gap-4">
          <SkeletonButton width="w-36" />
          <SkeletonLine width="w-28" height="h-4" />
        </div>
        <SkeletonBlock className="h-48 rounded-lg" />
      </div>
    </ToolShell>
  );
}

/* ── 16. YAML to JSON ────────────────────────────────────── */

function YamlToJsonSkeleton() {
  return (
    <ToolShell>
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <SkeletonLine width="w-16" height="h-5" />
            <div className="flex gap-2">
              <SkeletonButton width="w-28" />
              <SkeletonButton width="w-16" />
            </div>
          </div>
          <SkeletonTextArea className="min-h-[500px]" />
        </div>
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <SkeletonLine width="w-16" height="h-5" />
            <div className="flex gap-2">
              <SkeletonButton width="w-16" />
              <SkeletonButton width="w-20" />
            </div>
          </div>
          <SkeletonBlock className="min-h-[500px] rounded-lg bg-muted" />
        </div>
      </div>
      <div className="mt-6 flex items-center justify-center gap-4">
        <SkeletonButton width="w-40" />
        <SkeletonLine width="w-28" height="h-4" />
      </div>
    </ToolShell>
  );
}

/* ── 17. Image Resizer ───────────────────────────────────── */

function ImageResizerSkeleton() {
  return (
    <ToolShell>
      <div className="grid grid-cols-1 gap-8 lg:grid-cols-12">
        <div className="space-y-6 lg:col-span-7">
          <div className="rounded-xl border-2 border-dashed border-border p-10">
            <div className="flex flex-col items-center gap-3">
              <SkeletonBlock className="size-12 rounded-full" />
              <SkeletonLine width="w-48" height="h-5" />
              <SkeletonLine width="w-56" height="h-4" />
            </div>
          </div>
          <div className="rounded-xl border border-border p-6">
            <SkeletonLine width="w-36" height="h-5" className="mb-5" />
            <div className="mb-4 flex gap-2">
              <SkeletonButton width="w-20" />
              <SkeletonButton width="w-20" />
            </div>
            <div className="mb-4 flex items-center gap-3">
              <SkeletonBlock className="h-10 flex-1 rounded-lg" />
              <SkeletonBlock className="size-8 rounded" />
              <SkeletonBlock className="h-10 flex-1 rounded-lg" />
            </div>
            <SkeletonLine width="w-16" height="h-4" className="mb-2" />
            <SkeletonBlock className="mb-4 h-2 rounded-full" />
            <SkeletonButton width="w-full" />
          </div>
        </div>
        <div className="lg:col-span-5">
          <div className="sticky top-24 rounded-xl border border-border p-4">
            <SkeletonLine width="w-24" height="h-5" className="mb-4" />
            <SkeletonBlock className="aspect-square rounded-lg" />
            <div className="mt-4 flex justify-between">
              <SkeletonLine width="w-24" height="h-3" />
              <SkeletonLine width="w-24" height="h-3" />
            </div>
          </div>
        </div>
      </div>
    </ToolShell>
  );
}

/* ── Registry ────────────────────────────────────────────── */

const skeletonMap: Record<string, ComponentType<SkeletonProps>> = {
  "qr-generator": QrGeneratorSkeleton,
  "image-metadata-removal": ImageMetadataRemovalSkeleton,
  "base64-encoder": Base64EncoderSkeleton,
  "case-converter": CaseConverterSkeleton,
  "json-formatter": JsonFormatterSkeleton,
  "cron-parser": CronParserSkeleton,
  "csv-to-json": CsvToJsonSkeleton,
  "json-schema-generator": JsonSchemaGeneratorSkeleton,
  "jwt-decoder": JwtDecoderSkeleton,
  "lottie-previewer": LottiePreviewerSkeleton,
  "lorem-ipsum": LoremIpsumSkeleton,
  "markdown-preview": MarkdownPreviewSkeleton,
  "svg-optimizer": SvgOptimizerSkeleton,
  "favicon-generator": FaviconGeneratorSkeleton,
  "diff-checker": DiffCheckerSkeleton,
  "yaml-to-json": YamlToJsonSkeleton,
  "image-resizer": ImageResizerSkeleton,
};

export function getSkeletonForSlug(slug: string): ComponentType<SkeletonProps> | null {
  return skeletonMap[slug] ?? null;
}
