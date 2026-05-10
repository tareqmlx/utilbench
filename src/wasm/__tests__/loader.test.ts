import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { compileWasm, instantiateWasm } from "../loader";

// We need to reset the module-level cache between tests
// so we re-import the module fresh each time via vi.importActual

describe("compileWasm", () => {
  const fakeModule = {} as WebAssembly.Module;
  const fakeInstance = { exports: {} } as WebAssembly.Instance;
  const fakeResponse = {
    clone: () => fakeResponse,
    arrayBuffer: () => Promise.resolve(new ArrayBuffer(8)),
  } as unknown as Response;

  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.resolve(fakeResponse)),
    );
    vi.stubGlobal("WebAssembly", {
      compileStreaming: vi.fn(() => Promise.resolve(fakeModule)),
      compile: vi.fn(() => Promise.resolve(fakeModule)),
      instantiate: vi.fn(() => Promise.resolve(fakeInstance)),
      Module: class {},
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("compiles a WASM module from URL", async () => {
    const mod = await compileWasm("http://localhost/test.wasm");
    expect(mod).toBe(fakeModule);
    expect(fetch).toHaveBeenCalledWith("http://localhost/test.wasm");
  });

  it("uses streaming compilation first", async () => {
    await compileWasm("http://localhost/stream.wasm");
    expect(WebAssembly.compileStreaming).toHaveBeenCalled();
  });

  it("falls back to compile(arrayBuffer) when streaming fails", async () => {
    vi.mocked(WebAssembly.compileStreaming).mockRejectedValueOnce(new Error("no streaming"));

    const mod = await compileWasm("http://localhost/fallback.wasm");
    expect(mod).toBe(fakeModule);
    expect(WebAssembly.compile).toHaveBeenCalled();
  });

  it("caches modules by URL", async () => {
    await compileWasm("http://localhost/cached.wasm");
    await compileWasm("http://localhost/cached.wasm");

    // fetch should only be called once for the same URL
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  describe("instantiateWasm", () => {
    it("compiles and instantiates a module", async () => {
      const instance = await instantiateWasm("http://localhost/inst.wasm");
      expect(instance).toBe(fakeInstance);
      expect(WebAssembly.instantiate).toHaveBeenCalledWith(fakeModule, undefined);
    });

    it("passes imports to instantiate", async () => {
      const imports = { env: { memory: {} } };
      await instantiateWasm("http://localhost/inst2.wasm", imports);
      expect(WebAssembly.instantiate).toHaveBeenCalledWith(fakeModule, imports);
    });
  });
});
