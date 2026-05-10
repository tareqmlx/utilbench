import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { Resvg } from "@resvg/resvg-js";
import satori from "satori";

const distDir = join(import.meta.dirname, "..", "dist");

const logoSvg =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128" fill="none"><rect width="128" height="128" rx="24" fill="#6765f1"/><path d="M24 20L24 82Q24 108 64 108Q104 108 104 82L104 20L82 20L82 78L66 52Q64 48 62 52L46 78L46 20Z" fill="white"/></svg>';
const logoDataUri = `data:image/svg+xml;base64,${Buffer.from(logoSvg).toString("base64")}`;

async function generateOgImage() {
  // Satori requires TTF/OTF/WOFF — fetch Inter from Google Fonts API
  const cssResponse = await fetch(
    "https://fonts.googleapis.com/css2?family=Inter:wght@400;700&display=swap",
    { headers: { "User-Agent": "Mozilla/5.0 (compatible; MSIE 10.0)" } },
  );
  const css = await cssResponse.text();
  const fontUrlMatch = css.match(/url\(([^)]+)\)\s*format\('woff'\)/);
  if (!fontUrlMatch?.[1]) throw new Error("Could not find font URL in Google Fonts CSS");
  const fontResponse = await fetch(fontUrlMatch[1]);
  const fontData = Buffer.from(await fontResponse.arrayBuffer());

  const svg = await satori(
    {
      type: "div",
      props: {
        style: {
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          background: "linear-gradient(135deg, #111122 0%, #1a1a3e 50%, #111122 100%)",
          fontFamily: "Inter",
        },
        children: [
          {
            type: "div",
            props: {
              style: {
                display: "flex",
                alignItems: "center",
                gap: "20px",
                marginBottom: "32px",
              },
              children: [
                {
                  type: "img",
                  props: {
                    src: logoDataUri,
                    width: 72,
                    height: 72,
                  },
                },
                {
                  type: "div",
                  props: {
                    style: {
                      fontSize: "64px",
                      fontWeight: 800,
                      color: "white",
                      letterSpacing: "-2px",
                    },
                    children: "Utilbench",
                  },
                },
              ],
            },
          },
          {
            type: "div",
            props: {
              style: {
                fontSize: "28px",
                color: "#94a3b8",
                maxWidth: "700px",
                textAlign: "center",
                lineHeight: "1.4",
              },
              children: "Your online toolbox — fast, private, and free.",
            },
          },
          {
            type: "div",
            props: {
              style: {
                display: "flex",
                gap: "16px",
                marginTop: "40px",
              },
              children: ["Media", "Data", "Text"].map((label) => ({
                type: "div",
                props: {
                  style: {
                    padding: "8px 20px",
                    borderRadius: "24px",
                    background: "rgba(103, 101, 241, 0.15)",
                    color: "#6765f1",
                    fontSize: "18px",
                    fontWeight: 600,
                  },
                  children: label,
                },
              })),
            },
          },
        ],
      },
    },
    {
      width: 1200,
      height: 630,
      fonts: [
        {
          name: "Inter",
          data: fontData,
          weight: 400,
          style: "normal",
        },
        {
          name: "Inter",
          data: fontData,
          weight: 700,
          style: "normal",
        },
      ],
    },
  );

  const resvg = new Resvg(svg, {
    fitTo: { mode: "width", value: 1200 },
  });
  const pngData = resvg.render();
  const pngBuffer = pngData.asPng();

  writeFileSync(join(distDir, "og-image.png"), pngBuffer);
  console.log("OG image generated: dist/og-image.png");
}

generateOgImage().catch(console.error);
