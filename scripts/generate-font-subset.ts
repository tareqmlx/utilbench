import { writeFileSync } from "node:fs";
import { join } from "node:path";

const fontsDir = join(import.meta.dirname, "..", "public", "fonts");

const ICON_NAMES = [
  "add",
  "animation",
  "apps",
  "arrow_forward",
  "auto_fix_high",
  "bolt",
  "calendar_month",
  "check",
  "check_circle",
  "chevron_right",
  "close",
  "cloud_upload",
  "code",
  "code_blocks",
  "compare_arrows",
  "compress",
  "contact_page",
  "content_copy",
  "content_paste",
  "dark_mode",
  "data_object",
  "database",
  "delete",
  "delete_sweep",
  "description",
  "devices",
  "difference",
  "download",
  "download_done",
  "download_for_offline",
  "draw",
  "edit_note",
  "error",
  "explore_off",
  "file_upload",
  "fullscreen",
  "gif",
  "grid_view",
  "history",
  "home",
  "horizontal_rule",
  "image",
  "info",
  "input",
  "key",
  "light_mode",
  "link",
  "link_off",
  "location_off",
  "lock",
  "notes",
  "offline_pin",
  "palette",
  "pause",
  "photo_size_select_large",
  "play_arrow",
  "play_circle",
  "preview",
  "privacy_tip",
  "progress_activity",
  "qr_code_2",
  "refresh",
  "replay",
  "schedule",
  "schema",
  "search",
  "search_off",
  "security",
  "settings",
  "share",
  "shield",
  "shield_lock",
  "speed",
  "star",
  "swap_horiz",
  "sync",
  "sync_alt",
  "table_view",
  "terminal",
  "text_fields",
  "text_format",
  "token",
  "tune",
  "upload_file",
  "verified",
  "verified_user",
  "view_list",
  "visibility",
  "wifi",
];

async function generateFontSubset() {
  const sorted = [...ICON_NAMES].sort();
  const cssUrl = `https://fonts.googleapis.com/css2?family=Material+Symbols+Rounded&icon_names=${sorted.join(",")}`;

  console.log(`Fetching CSS for ${ICON_NAMES.length} icons...`);

  const cssResponse = await fetch(cssUrl, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
    },
  });

  if (!cssResponse.ok) {
    throw new Error(`Failed to fetch CSS: ${cssResponse.status} ${cssResponse.statusText}`);
  }

  const css = await cssResponse.text();

  const woff2Match = css.match(/url\((https:\/\/fonts\.gstatic\.com\/[^)]+)\)\s*format\(['"]woff2['"]\)/);
  if (!woff2Match?.[1]) {
    throw new Error("Could not extract woff2 URL from CSS response");
  }

  const woff2Url = woff2Match[1];
  console.log(`Downloading woff2 from ${woff2Url}...`);

  const fontResponse = await fetch(woff2Url);
  if (!fontResponse.ok) {
    throw new Error(`Failed to fetch font: ${fontResponse.status} ${fontResponse.statusText}`);
  }

  const fontBuffer = Buffer.from(await fontResponse.arrayBuffer());
  const outPath = join(fontsDir, "material-symbols.woff2");
  writeFileSync(outPath, fontBuffer);

  console.log(`Font saved: public/fonts/material-symbols.woff2 (${fontBuffer.length} bytes)`);
}

generateFontSubset().catch(console.error);
