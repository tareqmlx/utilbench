const moduleCache = new Map<string, WebAssembly.Module>();

/**
 * Compile a WASM module from a URL, using cache if available.
 * Uses compileStreaming when possible, falls back to compile(arrayBuffer).
 */
export async function compileWasm(url: string): Promise<WebAssembly.Module> {
  const cached = moduleCache.get(url);
  if (cached) return cached;

  const response = await fetch(url);
  let module: WebAssembly.Module;

  try {
    // compileStreaming requires a fresh Response, so clone before consuming
    module = await WebAssembly.compileStreaming(Promise.resolve(response.clone()));
  } catch {
    const buffer = await response.arrayBuffer();
    module = await WebAssembly.compile(buffer);
  }

  moduleCache.set(url, module);
  return module;
}

/**
 * Compile and instantiate a WASM module with given imports.
 */
export async function instantiateWasm(
  url: string,
  imports?: WebAssembly.Imports,
): Promise<WebAssembly.Instance> {
  const module = await compileWasm(url);
  return WebAssembly.instantiate(module, imports);
}
