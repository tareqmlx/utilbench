import { Shield } from "lucide-react";
import { Link } from "react-router-dom";
import { APP_NAME } from "../config";
import { JsonLd, SEOHead, buildBreadcrumbSchema, buildWebPageSchema } from "../seo";

const sections = [
  {
    label: "§ 01",
    title: "The short version",
    body: `${APP_NAME} is built for privacy. Every tool runs entirely in your browser — your files, text, and data never leave your device. We don't collect personal information, we don't use cookies, and we don't track you.`,
  },
  {
    label: "§ 02",
    title: "Data processing",
    body: "All processing happens client-side using JavaScript, Web Workers, and WebAssembly. When you convert an image, format JSON, or use any other tool, the work is performed locally on your machine. No data is uploaded to or processed on any server.",
  },
  {
    label: "§ 03",
    title: "No data collection",
    body: "We do not collect, store, or transmit any personal data — no files, no input text, no name or email, no IP addresses, no device fingerprints.",
  },
  {
    label: "§ 04",
    title: "Cookies & tracking",
    body: `${APP_NAME} does not use cookies, analytics scripts, or any third-party tracking. The only local storage used is for tool preferences you set yourself (e.g. last-used mode, formatting options) — these stay on your device and are never sent anywhere.`,
  },
  {
    label: "§ 05",
    title: "Third-party services",
    body: "The site is hosted on Cloudflare Workers. Cloudflare may collect standard server access logs (IP address, request URL, timestamp) as part of serving the site and routing requests through its global network. We don't have access to individual visitor data from these logs. No other third-party services are used.",
  },
  {
    label: "§ 06",
    title: "Transparency",
    body: "All processing runs client-side in your browser, which you can verify using your browser's developer tools. No network requests are made with your data.",
  },
];

export function Component() {
  return (
    <div className="wb-shell pt-9 pb-16">
      <SEOHead
        title="Privacy Policy | Utilbench"
        description="Utilbench toolbox runs entirely client-side. No data collection, no cookies, no tracking."
        canonicalPath="/privacy"
      />
      <JsonLd
        data={buildWebPageSchema(
          "Privacy Policy",
          "Utilbench privacy policy — no data collection, no cookies, no tracking.",
          "/privacy",
        )}
      />
      <JsonLd data={buildBreadcrumbSchema([{ name: "Home", url: "/" }, { name: "Privacy" }])} />

      <nav
        aria-label="Breadcrumb"
        className="flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.12em] text-ink-3"
      >
        <Link to="/" className="hover:text-ink">
          Utilbench
        </Link>
        <span className="opacity-40">/</span>
        <span className="font-medium text-ink">Privacy</span>
      </nav>

      <section className="mt-5 grid gap-7 border-b-2 border-ink pb-9 lg:grid-cols-[auto_1fr] lg:items-center">
        <div className="grid size-24 -rotate-[4deg] place-items-center rounded-lg border-2 border-ink bg-mint shadow-pop-3">
          <Shield className="size-11" strokeWidth={2} />
        </div>
        <div>
          <h1 className="wb-h1 mb-3" style={{ fontSize: "clamp(40px,7vw,72px)" }}>
            The privacy <em className="text-tomato">bit</em>.
          </h1>
          <p className="max-w-[60ch] text-[16px] leading-relaxed text-ink-2">
            Last updated: March 15, 2026. Short version below — even shorter version: nothing leaves
            your browser.
          </p>
          <div className="mt-4 flex flex-wrap gap-2.5">
            <span className="wb-sticker wb-sticker--mint">
              <span className="dot bg-grass" />0 cookies
            </span>
            <span className="wb-sticker wb-sticker--sky">
              <span className="dot bg-grass" />0 trackers
            </span>
            <span className="wb-sticker wb-sticker--pink">
              <span className="dot bg-grass" />0 servers touch your data
            </span>
          </div>
        </div>
      </section>

      <div className="mt-10 grid gap-[18px] md:grid-cols-2">
        {sections.map((s) => (
          <article
            key={s.label}
            className="rounded-lg border-2 border-ink bg-paper p-6 shadow-pop-3"
          >
            <span className="font-mono text-[11px] uppercase tracking-[0.12em] text-tomato">
              {s.label}
            </span>
            <h2 className="wb-h3 mt-2 mb-2" style={{ fontSize: 22 }}>
              {s.title}
            </h2>
            <p className="text-[14px] leading-relaxed text-ink-2">{s.body}</p>
          </article>
        ))}
      </div>

      <div className="mt-10 flex flex-wrap items-center justify-center gap-3">
        <Link to="/tools" className="wb-btn">
          Browse the workbench →
        </Link>
        <Link to="/" className="wb-btn wb-btn--ghost">
          Back home
        </Link>
      </div>
    </div>
  );
}
