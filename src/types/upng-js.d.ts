// upng-js ships no bundled types. Minimal declaration for the calls we use
// (plan §3.3). UPNG.encode quantizes to a palette when cnum is 2..256.
declare module "upng-js" {
  interface UPNG {
    /** @param cnum palette size (2..256 quantizes; 0 = lossless). */
    encode(imgs: ArrayBuffer[], w: number, h: number, cnum: number): ArrayBuffer;
    decode(buffer: ArrayBuffer): { width: number; height: number; data: Uint8Array };
    toRGBA8(img: { width: number; height: number; data: Uint8Array }): ArrayBuffer[];
  }
  const UPNG: UPNG;
  export default UPNG;
}
