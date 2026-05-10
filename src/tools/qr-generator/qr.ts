import QRCode from "qrcode";

export type ContentType = "URL" | "Text" | "WiFi" | "vCard";

export interface ContentFields {
  textInput: string;
  wifiSsid: string;
  wifiPassword: string;
  vcardName: string;
  vcardOrg: string;
}

export interface QrOptions {
  size: number;
  errorCorrection: "L" | "M" | "Q" | "H";
  foregroundColor: string;
  backgroundColor: string;
  quietZone: number;
}

export function buildPayload(contentType: ContentType, fields: ContentFields): string {
  switch (contentType) {
    case "URL":
    case "Text":
      return fields.textInput;
    case "WiFi":
      if (!fields.wifiSsid) return "";
      return `WIFI:S:${fields.wifiSsid};T:WPA;P:${fields.wifiPassword};;`;
    case "vCard":
      if (!fields.vcardName) return "";
      return `BEGIN:VCARD\nVERSION:3.0\nFN:${fields.vcardName}\nORG:${fields.vcardOrg}\nEND:VCARD`;
  }
}

export async function generateQrSvg(payload: string, options: QrOptions): Promise<string> {
  return QRCode.toString(payload, {
    type: "svg",
    width: options.size,
    errorCorrectionLevel: options.errorCorrection,
    color: {
      dark: options.foregroundColor,
      light: options.backgroundColor,
    },
    margin: options.quietZone,
  });
}

export async function generateQrPng(payload: string, options: QrOptions): Promise<string> {
  return QRCode.toDataURL(payload, {
    width: options.size,
    errorCorrectionLevel: options.errorCorrection,
    color: {
      dark: options.foregroundColor,
      light: options.backgroundColor,
    },
    margin: options.quietZone,
  });
}

export function isValidHexColor(color: string): boolean {
  return /^#([0-9A-Fa-f]{3}|[0-9A-Fa-f]{6})$/.test(color);
}
