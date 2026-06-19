import {
  PDFDict,
  PDFDocument,
  PDFHexString,
  PDFName,
  PDFRawStream,
  PDFRef,
  PDFString,
} from "pdf-lib";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildCleanedFilename,
  buildZip,
  downloadBlob,
  getPdfMeta,
  readFileBytes,
  readPdfMetadata,
  stripPdfMetadata,
  validatePdfFile,
} from "../metadata";

const META = PDFName.of("Metadata");

// Latin-1 decode so we can byte-scan for plaintext markers in the serialized PDF.
function latin1(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i] ?? 0);
  return s;
}

/** A doc with all 8 standard Info fields populated, saved with production-ish opts. */
async function makePopulatedDoc(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.addPage([612, 792]);
  doc.setTitle("My Title");
  doc.setAuthor("Jane Doe");
  doc.setSubject("Test Subject");
  doc.setKeywords(["alpha", "beta"]);
  doc.setCreator("Acme Creator");
  doc.setProducer("Acme Producer");
  doc.setCreationDate(new Date("2021-03-04T00:00:00Z"));
  doc.setModificationDate(new Date("2022-06-19T00:00:00Z"));
  return doc.save();
}

/** Inject an XMP /Metadata stream as an indirect ref containing a marker. */
function injectXmp(doc: PDFDocument, marker: string, compressed = false): PDFRef {
  const xml = `<?xpacket begin="﻿" id="W5M0MpCehiHzreSzNTczkc9d"?>
<x:xmpmeta xmlns:x="adobe:ns:meta/">
 <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
  <rdf:Description xmlns:xmpMM="http://ns.adobe.com/xap/1.0/mm/"
    xmpMM:DocumentID="${marker}"/>
 </rdf:RDF>
</x:xmpmeta>
<?xpacket end="w"?>`;
  const bytes = new TextEncoder().encode(xml);
  const dict = doc.context.obj({
    Type: "Metadata",
    Subtype: "XML",
    Length: bytes.length,
  });
  const stream = PDFRawStream.of(dict, bytes);
  const ref = doc.context.register(stream);
  doc.catalog.set(META, ref);
  void compressed;
  return ref;
}

afterEach(() => {
  vi.restoreAllMocks();
});

// ────────────────────────────────────────────────────────────────────────────
// stripPdfMetadata — the privacy suite
// ────────────────────────────────────────────────────────────────────────────

describe("stripPdfMetadata", () => {
  it("removes all standard Info fields", async () => {
    const input = await makePopulatedDoc();
    const out = await stripPdfMetadata(input);

    // STRUCTURAL checks on a FRESH re-parse FIRST — calling a getter recreates an empty Info dict
    // via the getInfoDict footgun, which would make trailerInfo.Info === undefined falsely fail.
    const reloaded = await PDFDocument.load(out, { ignoreEncryption: true, updateMetadata: false });
    expect(reloaded.context.trailerInfo.Info).toBeUndefined();
    expect(reloaded.catalog.get(META)).toBeUndefined();
    expect(reloaded.context.trailerInfo.ID).toBeUndefined();

    // Only NOW, in a separate block, may we call getters (each recreates Info but returns undefined).
    expect(reloaded.getTitle()).toBeUndefined();
    expect(reloaded.getAuthor()).toBeUndefined();
    expect(reloaded.getSubject()).toBeUndefined();
    expect(reloaded.getKeywords()).toBeUndefined();
    expect(reloaded.getCreator()).toBeUndefined();
    expect(reloaded.getProducer()).toBeUndefined();
    expect(reloaded.getCreationDate()).toBeUndefined();
    expect(reloaded.getModificationDate()).toBeUndefined();
  });

  it("removes the XMP stream (indirect ref)", async () => {
    const doc = await PDFDocument.create();
    doc.addPage([612, 792]);
    injectXmp(doc, "uuid-doc-id-123");
    const input = await doc.save();

    const out = await stripPdfMetadata(input);
    const reloaded = await PDFDocument.load(out, { ignoreEncryption: true, updateMetadata: false });
    expect(reloaded.catalog.get(META)).toBeUndefined();
  });

  it("removes the XMP stream when it is a DIRECT stream (no ref)", async () => {
    const doc = await PDFDocument.create();
    doc.addPage([612, 792]);
    // Direct inline stream value on the catalog (not registered as an indirect object).
    const bytes = new TextEncoder().encode("<x:xmpmeta>DIRECTXMP</x:xmpmeta>");
    const dict = doc.context.obj({ Type: "Metadata", Subtype: "XML", Length: bytes.length });
    const stream = PDFRawStream.of(dict, bytes);
    doc.catalog.set(META, stream);
    const input = await doc.save();

    const out = await stripPdfMetadata(input);
    const reloaded = await PDFDocument.load(out, { ignoreEncryption: true, updateMetadata: false });
    // Unlinking the catalog key is sufficient; ctx.delete is correctly skipped by instanceof guard.
    expect(reloaded.catalog.get(META)).toBeUndefined();
  });

  it("removes an inline (direct, non-ref) Info dict", async () => {
    const doc = await PDFDocument.create();
    doc.addPage([612, 792]);
    const input = await doc.save();
    // Re-load and set a DIRECT Info dict (not an indirect ref) on the trailer.
    const reloaded = await PDFDocument.load(input, {
      ignoreEncryption: true,
      updateMetadata: false,
    });
    const directInfo = reloaded.context.obj({ Title: PDFString.of("DirectTitle") });
    reloaded.context.trailerInfo.Info = directInfo as PDFDict;
    const withDirect = await reloaded.save();

    const out = await stripPdfMetadata(withDirect);
    const final = await PDFDocument.load(out, { ignoreEncryption: true, updateMetadata: false });
    expect(final.context.trailerInfo.Info).toBeUndefined();
  });

  it("removes the trailer /ID and does not regenerate one on save", async () => {
    const doc = await PDFDocument.create();
    doc.addPage([612, 792]);
    // Set an explicit /ID pair on the trailer.
    const id = doc.context.obj([PDFHexString.of("AABBCCDD"), PDFHexString.of("AABBCCDD")]);
    // biome-ignore lint/suspicious/noExplicitAny: trailerInfo.ID typing is a PDFArray.
    doc.context.trailerInfo.ID = id as any;
    const input = await doc.save();

    const out = await stripPdfMetadata(input);
    const reloaded = await PDFDocument.load(out, { ignoreEncryption: true, updateMetadata: false });
    expect(reloaded.context.trailerInfo.ID).toBeUndefined();
  });

  it("BYTE-SCAN: does not leak an orphaned Info-dict value (no-GC bug)", async () => {
    // Put a literal ASCII marker in a CUSTOM Info key. PDFString.of → (SECRETMARKER123) when
    // uncompressed. Production save (useObjectStreams:true) compresses Info into object streams and
    // would hide a leak, so the byte-scan path MUST disable object streams to be meaningful.
    const marker = "SECRETMARKER123";
    const doc = await PDFDocument.create();
    doc.addPage([612, 792]);
    doc.setTitle("placeholder");
    const infoRef = doc.context.trailerInfo.Info as PDFRef;
    const infoDict = doc.context.lookup(infoRef, PDFDict);
    infoDict.set(PDFName.of("CustomKey"), PDFString.of(marker));
    const input = await doc.save({ useObjectStreams: false });

    // Positive control: the marker IS present in the un-stripped, uncompressed fixture.
    expect(latin1(input)).toContain(marker);

    const stripped = await stripPdfMetadata(input);
    // Re-serialize the stripped doc WITHOUT object streams so a leaked object would be visible.
    const reStripped = await PDFDocument.load(stripped, {
      ignoreEncryption: true,
      updateMetadata: false,
    });
    const rescan = await reStripped.save({ useObjectStreams: false });
    expect(latin1(rescan)).not.toContain(marker);
  });

  it("BYTE-SCAN: does not leak an orphaned XMP stream on the PRODUCTION save path", async () => {
    // XMP is a STREAM object → never placed in an object stream, so it is written standalone even
    // under useObjectStreams:true. Use an uncompressed XMP fixture so the scan is decisive.
    const marker = "SECRETXMPUUID456";
    const doc = await PDFDocument.create();
    doc.addPage([612, 792]);
    injectXmp(doc, marker);
    const input = await doc.save();
    // Positive control: marker present before strip.
    expect(latin1(input)).toContain(marker);

    // Strip uses the PRODUCTION opts internally.
    const out = await stripPdfMetadata(input);
    expect(latin1(out)).not.toContain(marker);
  });

  it("BYTE-SCAN: does not leak a hex-encoded Info value orphan", async () => {
    // setTitle stores PDFHexString.fromText (UTF-16BE hex) — the ASCII marker won't appear literally,
    // so assert the hex byte sequence is absent from the uncompressed stripped output.
    const text = "SECRETHEX789";
    const doc = await PDFDocument.create();
    doc.addPage([612, 792]);
    const infoDict = doc.context.obj({});
    infoDict.set(PDFName.of("Title"), PDFHexString.fromText(text));
    const infoRef = doc.context.register(infoDict);
    doc.context.trailerInfo.Info = infoRef;
    const input = await doc.save({ useObjectStreams: false });

    // The hex sequence (UTF-16BE) of the text, as it appears between < > in the PDF.
    const hex = PDFHexString.fromText(text).toString().replace(/[<>]/g, "");
    // Positive control: the hex IS present uncompressed before strip.
    expect(latin1(input).toUpperCase()).toContain(hex.toUpperCase());

    const stripped = await stripPdfMetadata(input);
    const reStripped = await PDFDocument.load(stripped, {
      ignoreEncryption: true,
      updateMetadata: false,
    });
    const rescan = await reStripped.save({ useObjectStreams: false });
    expect(latin1(rescan).toUpperCase()).not.toContain(hex.toUpperCase());
  });

  it("does not re-stamp pdf-lib Producer on the output", async () => {
    // create() itself stamps Producer = "pdf-lib (...)" via updateInfoDict(). pdf-lib stores Info
    // strings as UTF-16BE HEX (<FEFF...>), so "pdf-lib" never appears as ASCII — scan for the hex
    // form. Production save also compresses Info into an object stream, so build the positive
    // control with useObjectStreams:false where the hex appears in plaintext (non-vacuous: the
    // marker is guaranteed present in the input). This proves strip + updateMetadata:false removed
    // it without re-injecting it.
    const producerHex = PDFHexString.fromText("pdf-lib").toString().replace(/[<>]/g, "");
    const doc = await PDFDocument.create();
    doc.addPage([612, 792]);
    doc.setTitle("Has Producer");
    const input = await doc.save({ useObjectStreams: false });
    expect(latin1(input).toUpperCase()).toContain(producerHex.toUpperCase());

    const stripped = await stripPdfMetadata(input);
    // Re-serialize uncompressed so any leaked Producer would be visible as plaintext.
    const reStripped = await PDFDocument.load(stripped, {
      ignoreEncryption: true,
      updateMetadata: false,
    });
    const rescan = await reStripped.save({ useObjectStreams: false });
    expect(latin1(rescan).toUpperCase()).not.toContain(producerHex.toUpperCase());

    // Re-stamp guard via structural re-parse (NOT getProducer, which recreates an empty Info).
    const reloaded = await PDFDocument.load(stripped, {
      ignoreEncryption: true,
      updateMetadata: false,
    });
    expect(reloaded.context.trailerInfo.Info).toBeUndefined();
  });

  it("drops exactly the deleted indirect objects (no-GC delta, in-memory)", async () => {
    // Replicate the delete sequence inline and measure on the in-memory context across the deletes.
    // stripPdfMetadata returns bytes only, so we prove the mechanism here; the function's own
    // coverage is the byte-scan + structural tests above.
    const doc = await PDFDocument.create();
    doc.addPage([612, 792]);
    doc.setTitle("Has Info");
    injectXmp(doc, "delta-uuid");
    const input = await doc.save();

    const loaded = await PDFDocument.load(input, {
      ignoreEncryption: true,
      updateMetadata: false,
    });
    const ctx = loaded.context;

    const xmpRef = loaded.catalog.get(META);
    const infoRef = ctx.trailerInfo.Info;
    const xmpWasRef = xmpRef instanceof PDFRef;
    const infoWasRef = infoRef instanceof PDFRef;

    const before = ctx.enumerateIndirectObjects().length;
    if (xmpRef instanceof PDFRef) {
      loaded.catalog.delete(META);
      ctx.delete(xmpRef);
    }
    if (infoRef instanceof PDFRef) {
      ctx.trailerInfo.Info = undefined;
      ctx.delete(infoRef);
    }
    const after = ctx.enumerateIndirectObjects().length;

    expect(before - after).toBe((xmpWasRef ? 1 : 0) + (infoWasRef ? 1 : 0));
  });

  it("is idempotent — strip(strip(bytes)) loads fine and stays clean", async () => {
    const input = await makePopulatedDoc();
    const once = await stripPdfMetadata(input);
    const twice = await stripPdfMetadata(once);

    const reloaded = await PDFDocument.load(twice, {
      ignoreEncryption: true,
      updateMetadata: false,
    });
    expect(reloaded.context.trailerInfo.Info).toBeUndefined();
    expect(reloaded.catalog.get(META)).toBeUndefined();
    expect(reloaded.context.trailerInfo.ID).toBeUndefined();
  });

  it("throws on encrypted input", async () => {
    const doc = await PDFDocument.create();
    doc.addPage([612, 792]);
    const input = await doc.save();
    const realLoad = PDFDocument.load.bind(PDFDocument);
    vi.spyOn(PDFDocument, "load").mockImplementation(async (...args) => {
      const d = await realLoad(args[0] as Uint8Array, args[1]);
      Object.defineProperty(d, "isEncrypted", { get: () => true });
      return d;
    });
    await expect(stripPdfMetadata(input)).rejects.toThrow(/password-protected/i);
  });

  it("preserves the page count of a multi-page fixture", async () => {
    const doc = await PDFDocument.create();
    doc.addPage([612, 792]);
    doc.addPage([612, 792]);
    doc.addPage([612, 792]);
    doc.setTitle("Multi");
    const input = await doc.save();

    const out = await stripPdfMetadata(input);
    const reloaded = await PDFDocument.load(out, { ignoreEncryption: true, updateMetadata: false });
    expect(reloaded.getPageCount()).toBe(3);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// readPdfMetadata
// ────────────────────────────────────────────────────────────────────────────

describe("readPdfMetadata", () => {
  it("maps populated standard fields, XMP, custom keys, /ID, and counts", async () => {
    const doc = await PDFDocument.create();
    doc.addPage([612, 792]);
    doc.setTitle("My Title");
    doc.setAuthor("Jane Doe");
    doc.setSubject("Test Subject");
    doc.setKeywords(["alpha"]);
    doc.setCreator("Acme Creator");
    doc.setProducer("Acme Producer");
    doc.setCreationDate(new Date("2021-03-04T00:00:00Z"));
    doc.setModificationDate(new Date("2022-06-19T00:00:00Z"));
    const infoRef = doc.context.trailerInfo.Info as PDFRef;
    const infoDict = doc.context.lookup(infoRef, PDFDict);
    infoDict.set(PDFName.of("Trapped"), PDFName.of("True"));
    injectXmp(doc, "read-uuid");
    const id = doc.context.obj([PDFHexString.of("AA"), PDFHexString.of("AA")]);
    // biome-ignore lint/suspicious/noExplicitAny: trailerInfo.ID is a PDFArray.
    doc.context.trailerInfo.ID = id as any;
    const input = await doc.save();

    const meta = await readPdfMetadata(input);
    expect(meta.encrypted).toBe(false);
    expect(meta.title).toBe("My Title");
    expect(meta.author).toBe("Jane Doe");
    expect(meta.subject).toBe("Test Subject");
    expect(meta.creator).toBe("Acme Creator");
    expect(meta.producer).toBe("Acme Producer");
    expect(meta.creationDate).toBeInstanceOf(Date);
    expect(meta.modificationDate).toBeInstanceOf(Date);
    expect(meta.hasXmp).toBe(true);
    expect(meta.hasDocumentId).toBe(true);
    expect(meta.customKeys).toContain("Trapped");
    expect(meta.customKeys).not.toContain("Title");
    expect(meta.pageCount).toBe(1);
    // 8 standard + 1 custom + xmp + id = 11.
    expect(meta.fieldCount).toBe(11);
  });

  it("returns null/false/0 for an empty doc", async () => {
    const doc = await PDFDocument.create();
    doc.addPage([612, 792]);
    // create() stamps a Producer; clear the Info dict to get a truly empty doc.
    const infoRef = doc.context.trailerInfo.Info;
    if (infoRef instanceof PDFRef) {
      const infoDict = doc.context.lookup(infoRef, PDFDict);
      for (const k of [...infoDict.keys()]) infoDict.delete(k);
      doc.context.trailerInfo.Info = undefined;
      doc.context.delete(infoRef);
    }
    const input = await doc.save();

    const meta = await readPdfMetadata(input);
    expect(meta.title).toBeNull();
    expect(meta.author).toBeNull();
    expect(meta.producer).toBeNull();
    expect(meta.hasXmp).toBe(false);
    expect(meta.hasDocumentId).toBe(false);
    expect(meta.customKeys).toEqual([]);
    expect(meta.fieldCount).toBe(0);
  });

  it("does not abort the read when a getter throws (pdf-lib #1571)", async () => {
    const input = await makePopulatedDoc();
    vi.spyOn(PDFDocument.prototype, "getProducer").mockImplementation(() => {
      throw new Error("boom");
    });
    const meta = await readPdfMetadata(input);
    expect(meta.producer).toBeNull();
    // Other fields still read fine.
    expect(meta.title).toBe("My Title");
    expect(meta.author).toBe("Jane Doe");
  });

  it("degrades to customKeys:[] when /Info points at a missing object", async () => {
    const doc = await PDFDocument.create();
    doc.addPage([612, 792]);
    const input = await doc.save();
    const loaded = await PDFDocument.load(input, {
      ignoreEncryption: true,
      updateMetadata: false,
    });
    // Point /Info at a dangling reference (object never registered).
    loaded.context.trailerInfo.Info = PDFRef.of(9999, 0);
    const dangling = await loaded.save();

    const meta = await readPdfMetadata(dangling);
    expect(meta.customKeys).toEqual([]);
  });

  it("returns { encrypted: true } with the summary skipped", async () => {
    const input = await makePopulatedDoc();
    const realLoad = PDFDocument.load.bind(PDFDocument);
    vi.spyOn(PDFDocument, "load").mockImplementation(async (...args) => {
      const d = await realLoad(args[0] as Uint8Array, args[1]);
      Object.defineProperty(d, "isEncrypted", { get: () => true });
      return d;
    });
    const meta = await readPdfMetadata(input);
    expect(meta.encrypted).toBe(true);
    expect(meta.title).toBeNull();
    expect(meta.author).toBeNull();
    expect(meta.hasXmp).toBe(false);
    expect(meta.fieldCount).toBe(0);
    expect(meta.pageCount).toBe(1);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// buildZip
// ────────────────────────────────────────────────────────────────────────────

describe("buildZip", () => {
  it("produces a zip blob", () => {
    const blob = buildZip([{ name: "a.pdf", data: new Uint8Array([1, 2, 3]) }]);
    expect(blob).toBeInstanceOf(Blob);
    expect(blob.type).toBe("application/zip");
    expect(blob.size).toBeGreaterThan(0);
  });

  it("de-dupes identical names with _2, _3", async () => {
    const { unzipSync } = await import("fflate");
    const blob = buildZip([
      { name: "report.pdf", data: new Uint8Array([1]) },
      { name: "report.pdf", data: new Uint8Array([2]) },
      { name: "report.pdf", data: new Uint8Array([3]) },
    ]);
    const buf = new Uint8Array(await blob.arrayBuffer());
    const entries = Object.keys(unzipSync(buf));
    expect(entries).toContain("report.pdf");
    expect(entries).toContain("report_2.pdf");
    expect(entries).toContain("report_3.pdf");
  });
});

// ────────────────────────────────────────────────────────────────────────────
// buildCleanedFilename
// ────────────────────────────────────────────────────────────────────────────

describe("buildCleanedFilename", () => {
  it("appends -no-metadata.pdf to the base name", () => {
    expect(buildCleanedFilename("report.pdf")).toBe("report-no-metadata.pdf");
  });

  it("falls back to document for empty/unsafe bases", () => {
    expect(buildCleanedFilename("!!!.pdf")).toBe("document-no-metadata.pdf");
    expect(buildCleanedFilename(".pdf")).toBe("document-no-metadata.pdf");
  });

  it("strips path-traversal segments to a single safe filename", () => {
    const out = buildCleanedFilename("../../etc/passwd.pdf");
    expect(out).not.toContain("/");
    expect(out).not.toContain("\\");
    expect(out).not.toContain("..");
    expect(out).toBe("passwd-no-metadata.pdf");
  });

  it("strips absolute paths", () => {
    const out = buildCleanedFilename("/abs/secret.pdf");
    expect(out).not.toContain("/");
    expect(out).toBe("secret-no-metadata.pdf");
  });

  it("strips backslash (Windows) path components", () => {
    const out = buildCleanedFilename("C:\\Users\\me\\file.pdf");
    expect(out).not.toContain("\\");
    expect(out).not.toContain("/");
  });

  it("strips null bytes and control characters", () => {
    const out = buildCleanedFilename("ev\x00il\x07name.pdf");
    expect(out).not.toContain("\x00");
    expect(out).not.toContain("\x07");
    expect(out).toBe("evilname-no-metadata.pdf");
  });

  it("caps very long names", () => {
    const longName = `${"a".repeat(5000)}.pdf`;
    const out = buildCleanedFilename(longName);
    expect(out.length).toBeLessThanOrEqual("-no-metadata.pdf".length + 200);
  });

  it("rejects Windows-reserved device names", () => {
    expect(buildCleanedFilename("CON.pdf")).toBe("document-no-metadata.pdf");
    expect(buildCleanedFilename("prn.pdf")).toBe("document-no-metadata.pdf");
    expect(buildCleanedFilename("NUL.pdf")).toBe("document-no-metadata.pdf");
    expect(buildCleanedFilename("com1.pdf")).toBe("document-no-metadata.pdf");
  });
});

// ────────────────────────────────────────────────────────────────────────────
// Re-export smoke
// ────────────────────────────────────────────────────────────────────────────

describe("re-exports from @/lib/pdf", () => {
  it("exposes validatePdfFile, readFileBytes, getPdfMeta, downloadBlob through ../metadata", () => {
    expect(typeof validatePdfFile).toBe("function");
    expect(typeof readFileBytes).toBe("function");
    expect(typeof getPdfMeta).toBe("function");
    expect(typeof downloadBlob).toBe("function");
  });

  it("validatePdfFile rejects a non-PDF", () => {
    const file = new File(["x"], "note.txt", { type: "text/plain" });
    expect(validatePdfFile(file).valid).toBe(false);
  });
});
