import { describe, expect, it, vi } from "vitest";
import { buildPayload, generateQrPng, generateQrSvg, isValidHexColor } from "../qr";
import type { ContentFields, QrOptions } from "../qr";

vi.mock("qrcode", () => ({
  default: {
    toString: vi.fn().mockResolvedValue("<svg>mock</svg>"),
    toDataURL: vi.fn().mockResolvedValue("data:image/png;base64,mock"),
  },
}));

import QRCode from "qrcode";

const defaultFields: ContentFields = {
  textInput: "",
  wifiSsid: "",
  wifiPassword: "",
  vcardName: "",
  vcardOrg: "",
};

const defaultOptions: QrOptions = {
  size: 512,
  errorCorrection: "M",
  foregroundColor: "#000000",
  backgroundColor: "#ffffff",
  quietZone: 4,
};

describe("buildPayload", () => {
  it("returns textInput for URL type", () => {
    expect(buildPayload("URL", { ...defaultFields, textInput: "https://example.com" })).toBe(
      "https://example.com",
    );
  });

  it("returns textInput for Text type", () => {
    expect(buildPayload("Text", { ...defaultFields, textInput: "hello world" })).toBe(
      "hello world",
    );
  });

  it("builds WiFi payload with SSID and password", () => {
    const result = buildPayload("WiFi", {
      ...defaultFields,
      wifiSsid: "MyNetwork",
      wifiPassword: "secret123",
    });
    expect(result).toBe("WIFI:S:MyNetwork;T:WPA;P:secret123;;");
  });

  it("returns empty string for WiFi without SSID", () => {
    expect(buildPayload("WiFi", { ...defaultFields, wifiPassword: "secret" })).toBe("");
  });

  it("builds WiFi payload with empty password", () => {
    const result = buildPayload("WiFi", { ...defaultFields, wifiSsid: "OpenNet" });
    expect(result).toBe("WIFI:S:OpenNet;T:WPA;P:;;");
  });

  it("builds vCard payload with name and org", () => {
    const result = buildPayload("vCard", {
      ...defaultFields,
      vcardName: "Jane Doe",
      vcardOrg: "Acme",
    });
    expect(result).toContain("BEGIN:VCARD");
    expect(result).toContain("FN:Jane Doe");
    expect(result).toContain("ORG:Acme");
    expect(result).toContain("END:VCARD");
  });

  it("returns empty string for vCard without name", () => {
    expect(buildPayload("vCard", { ...defaultFields, vcardOrg: "Acme" })).toBe("");
  });

  it("builds vCard with empty org", () => {
    const result = buildPayload("vCard", { ...defaultFields, vcardName: "Jane" });
    expect(result).toContain("FN:Jane");
    expect(result).toContain("ORG:");
  });
});

describe("generateQrSvg", () => {
  it("calls QRCode.toString with correct options", async () => {
    const mock = vi.mocked(QRCode.toString);
    mock.mockClear();

    await generateQrSvg("test", defaultOptions);

    expect(mock).toHaveBeenCalledWith("test", {
      type: "svg",
      width: 512,
      errorCorrectionLevel: "M",
      color: { dark: "#000000", light: "#ffffff" },
      margin: 4,
    });
  });

  it("returns SVG string", async () => {
    const result = await generateQrSvg("test", defaultOptions);
    expect(result).toContain("<svg>");
  });
});

describe("generateQrPng", () => {
  it("calls QRCode.toDataURL with correct options", async () => {
    const mock = vi.mocked(QRCode.toDataURL);
    mock.mockClear();

    await generateQrPng("test", { ...defaultOptions, size: 256, errorCorrection: "H" });

    expect(mock).toHaveBeenCalledWith("test", {
      width: 256,
      errorCorrectionLevel: "H",
      color: { dark: "#000000", light: "#ffffff" },
      margin: 4,
    });
  });

  it("returns data URL string", async () => {
    const result = await generateQrPng("test", defaultOptions);
    expect(result).toContain("data:image/png");
  });
});

describe("isValidHexColor", () => {
  it("accepts 6-digit hex", () => {
    expect(isValidHexColor("#000000")).toBe(true);
    expect(isValidHexColor("#ff00ff")).toBe(true);
    expect(isValidHexColor("#ABCDEF")).toBe(true);
  });

  it("accepts 3-digit hex", () => {
    expect(isValidHexColor("#fff")).toBe(true);
    expect(isValidHexColor("#abc")).toBe(true);
    expect(isValidHexColor("#F0A")).toBe(true);
  });

  it("rejects missing hash", () => {
    expect(isValidHexColor("000000")).toBe(false);
    expect(isValidHexColor("fff")).toBe(false);
  });

  it("rejects invalid characters", () => {
    expect(isValidHexColor("#gggggg")).toBe(false);
    expect(isValidHexColor("#xyz")).toBe(false);
  });

  it("rejects wrong length", () => {
    expect(isValidHexColor("#ff")).toBe(false);
    expect(isValidHexColor("#ffff")).toBe(false);
    expect(isValidHexColor("#fffffff")).toBe(false);
  });

  it("rejects empty string", () => {
    expect(isValidHexColor("")).toBe(false);
  });
});
