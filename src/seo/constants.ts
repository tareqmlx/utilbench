import { APP_DESCRIPTION, APP_NAME } from "../config";

export const SITE_URL = import.meta.env.VITE_SITE_URL ?? "https://utilbench.example.com";
export const DEFAULT_OG_IMAGE = `${SITE_URL}/og-image.png`;
export const DEFAULT_TITLE = `${APP_NAME} — Browser Utilities for Developers`;
export const DEFAULT_DESCRIPTION = APP_DESCRIPTION;
