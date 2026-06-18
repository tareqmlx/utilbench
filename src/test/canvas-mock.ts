import { vi } from "vitest";

function createFakePngData(width: number, height: number): Uint8Array {
  const data = new Uint8Array(24);
  data.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]); // PNG signature
  const view = new DataView(data.buffer);
  view.setUint32(8, 13, false); // IHDR length
  data.set([0x49, 0x48, 0x44, 0x52], 12); // "IHDR"
  view.setUint32(16, width, false);
  view.setUint32(20, height, false);
  return data;
}

// Store the real createElement to avoid recursive spying
const realCreateElement = document.createElement.bind(document);

export function setupCanvasMock() {
  const ctx = {
    drawImage: vi.fn(),
    fillRect: vi.fn(),
    clearRect: vi.fn(),
    getImageData: vi.fn(() => ({
      data: new Uint8ClampedArray(4),
      width: 1,
      height: 1,
    })),
    save: vi.fn(),
    restore: vi.fn(),
    beginPath: vi.fn(),
    arc: vi.fn(),
    clip: vi.fn(),
    roundRect: vi.fn(),
    fillStyle: "",
  };

  vi.spyOn(document, "createElement").mockImplementation(((
    tagName: string,
    options?: ElementCreationOptions,
  ) => {
    const el = realCreateElement(tagName, options);
    if (tagName === "canvas") {
      (el as unknown as Record<string, unknown>).getContext = vi.fn(() => ctx);
      (el as unknown as Record<string, unknown>).toBlob = vi.fn(
        (cb: BlobCallback, type?: string) => {
          const pngData = createFakePngData(el.width || 1, el.height || 1);
          cb(new Blob([pngData], { type: type ?? "image/png" }));
        },
      );
      (el as unknown as Record<string, unknown>).toDataURL = vi.fn(
        (type?: string) => `data:${type ?? "image/png"};base64,mock`,
      );
    }
    return el;
  }) as typeof document.createElement);

  return { ctx };
}

export function setupImageMock(dims: { width?: number; height?: number; fail?: boolean } = {}) {
  const w = dims.width ?? 100;
  const h = dims.height ?? 100;
  const fail = dims.fail ?? false;

  vi.stubGlobal(
    "Image",
    class MockImage {
      onload: (() => void) | null = null;
      onerror: ((e: unknown) => void) | null = null;
      naturalWidth = w;
      naturalHeight = h;
      width = w;
      height = h;
      private _src = "";

      get src() {
        return this._src;
      }
      set src(value: string) {
        this._src = value;
        if (value) {
          queueMicrotask(() =>
            fail ? this.onerror?.(new Error("decode failed")) : this.onload?.(),
          );
        }
      }
    },
  );
}

export function setupURLMock() {
  let counter = 0;
  const createObjectURL = vi.fn(() => `blob:mock-${++counter}`);
  const revokeObjectURL = vi.fn();
  (URL as unknown as Record<string, unknown>).createObjectURL = createObjectURL;
  (URL as unknown as Record<string, unknown>).revokeObjectURL = revokeObjectURL;
  return { createObjectURL, revokeObjectURL };
}

export function setupAllMocks(dims: { width?: number; height?: number } = {}) {
  const { ctx } = setupCanvasMock();
  setupImageMock(dims);
  const { createObjectURL, revokeObjectURL } = setupURLMock();
  return { ctx, createObjectURL, revokeObjectURL };
}
