export type Mode = "encode" | "decode";

export function encodeBase64(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}

export function decodeBase64(base64: string): string {
  const binary = atob(base64);
  const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

export function convert(text: string, mode: Mode): { result: string; error: string | null } {
  if (text === "") return { result: "", error: null };
  try {
    const result = mode === "encode" ? encodeBase64(text) : decodeBase64(text);
    return { result, error: null };
  } catch {
    return {
      result: "",
      error:
        mode === "decode"
          ? "Invalid Base64 string. Check for typos or missing padding."
          : "Encoding failed",
    };
  }
}
