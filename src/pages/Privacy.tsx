import { Cookie, Cpu, EyeOff, type LucideIcon, Server, Shield, TerminalSquare } from "lucide-react";
import { Link } from "react-router-dom";
import { APP_NAME } from "../config";
import { useScrollReveal } from "../hooks/useScrollReveal";
import { JsonLd, SEOHead, buildBreadcrumbSchema, buildWebPageSchema } from "../seo";

type SectionVariant = "tldr" | "default" | "muted";

type Section = {
  id: string;
  label: string;
  title: string;
  body: string;
  icon: LucideIcon;
  variant: SectionVariant;
};

const sections: Section[] = [
  {
    id: "tldr",
    label: "TL;DR",
    title: "Nothing leaves your browser.",
    body: `${APP_NAME} runs every tool entirely on your device. No accounts, no cookies, no analytics, no third-party scripts. Open a tab, do the work, close the tab. That's the whole policy.`,
    icon: Shield,
    variant: "tldr",
  },
  {
    id: "processing",
    label: "Processing",
    title: "Everything runs locally.",
    body: "Conversions, formatting, parsing, image work: all of it happens client-side via JavaScript, Web Workers, and WebAssembly. No data is uploaded to or processed on any server.",
    icon: Cpu,
    variant: "default",
  },
  {
    id: "collection",
    label: "Collection",
    title: "We don't collect anything.",
    body: 'No files, no input text, no name or email, no IP addresses, no device fingerprints. There is no "opt out" because there is no opt in. The "Report issue" button opens GitHub in a new tab, and only when you click it. It pre-fills anonymous diagnostics (app version, page, browser, error type and stack trace, viewport size, and timestamp). It never includes your input or any tool output.',
    icon: EyeOff,
    variant: "muted",
  },
  {
    id: "cookies",
    label: "Cookies",
    title: "No cookies, no tracking.",
    body: `${APP_NAME} sets zero cookies and loads zero tracking scripts. The only persistent state lives in your browser's local storage, and it holds the tool preferences you set yourself (last-used mode, formatting options). It never leaves your device.`,
    icon: Cookie,
    variant: "default",
  },
  {
    id: "hosting",
    label: "Hosting",
    title: "Cloudflare serves the bundle.",
    body: "The site is hosted on Cloudflare Workers. Cloudflare may keep standard server access logs (IP, request URL, timestamp) for routing and abuse prevention. We do not have access to individual visitor data from those logs, and no other third-party services are used.",
    icon: Server,
    variant: "muted",
  },
  {
    id: "verify",
    label: "Verify",
    title: "You can check this yourself.",
    body: "Open DevTools, switch to the Network tab, and use any tool. You will see the initial bundle load, then nothing. No requests with your data. That's the whole proof.",
    icon: TerminalSquare,
    variant: "default",
  },
];

const variantPanelClass: Record<SectionVariant, string> = {
  tldr: "wb-panel sm:col-span-2",
  default: "wb-panel",
  muted: "wb-panel wb-panel--out",
};

function PrivacyPanel({ section, index }: { section: Section; index: number }) {
  const ref = useScrollReveal<HTMLElement>({ delay: index * 60 });
  const Icon = section.icon;
  return (
    <article
      ref={ref}
      aria-labelledby={`privacy-${section.id}-title`}
      className={`wb-reveal ${variantPanelClass[section.variant]} flex flex-col gap-3 p-6 sm:p-7`}
    >
      <div className="flex items-center gap-3">
        <span className="grid size-9 place-items-center rounded border-2 border-ink bg-paper shadow-pop-1">
          <Icon className="size-[18px]" strokeWidth={2} aria-hidden="true" />
        </span>
        <span className="wb-meta">{section.label}</span>
      </div>
      <h2 id={`privacy-${section.id}-title`} className="wb-h3">
        {section.title}
      </h2>
      <p className="max-w-[60ch] text-[15px] leading-relaxed text-ink-2">{section.body}</p>
    </article>
  );
}

export function Component() {
  const ctaRef = useScrollReveal<HTMLDivElement>({ delay: 80 });

  return (
    <div className="wb-shell pt-9 pb-16">
      <SEOHead
        title="Privacy Policy | Utilbench"
        description="Utilbench runs entirely client-side. No data collection, no cookies, no tracking."
        canonicalPath="/privacy"
      />
      <JsonLd
        data={buildWebPageSchema(
          "Privacy Policy",
          "Utilbench privacy policy. No data collection, no cookies, no tracking.",
          "/privacy",
        )}
      />
      <JsonLd data={buildBreadcrumbSchema([{ name: "Home", url: "/" }, { name: "Privacy" }])} />

      <nav aria-label="Breadcrumb">
        <ol className="wb-meta flex items-center gap-2">
          <li>
            <Link to="/" className="wb-link-soft hover:text-ink">
              Home
            </Link>
          </li>
          <li aria-hidden="true" className="opacity-40">
            /
          </li>
          <li>
            <span aria-current="page" className="font-medium text-ink">
              Privacy
            </span>
          </li>
        </ol>
      </nav>

      <section
        aria-labelledby="privacy-title"
        className="mt-5 grid gap-7 border-b-2 border-ink pb-9 lg:grid-cols-[auto_1fr] lg:items-center"
      >
        <div className="wb-fade-in grid size-24 -rotate-[4deg] place-items-center rounded-lg border-2 border-ink bg-mint shadow-pop-3">
          <Shield className="size-11" strokeWidth={2} aria-hidden="true" />
        </div>
        <div className="wb-fade-in" style={{ animationDelay: "80ms" }}>
          <h1 id="privacy-title" className="wb-h1 wb-h1--page mb-3">
            The privacy <em className="text-tomato">bit</em>.
          </h1>
          <p className="max-w-[60ch] text-[16px] leading-relaxed text-ink-2">
            Last updated May 28, 2026. Short version: nothing leaves your browser. The longer
            version is below, broken into six panels so you can skim.
          </p>
          <ul
            className="wb-fade-in mt-4 flex flex-wrap gap-2.5"
            style={{ animationDelay: "160ms" }}
            aria-label="Privacy guarantees at a glance"
          >
            <li className="wb-sticker wb-sticker--mint">
              <span className="dot bg-grass" aria-hidden="true" />0 cookies
            </li>
            <li className="wb-sticker wb-sticker--sky">
              <span className="dot bg-grass" aria-hidden="true" />0 trackers
            </li>
            <li className="wb-sticker wb-sticker--pink">
              <span className="dot bg-grass" aria-hidden="true" />0 servers
            </li>
          </ul>
        </div>
      </section>

      <div className="mt-10 grid gap-[18px] sm:grid-cols-2">
        {sections.map((section, i) => (
          <PrivacyPanel key={section.id} section={section} index={i} />
        ))}
      </div>

      <div
        ref={ctaRef}
        className="wb-reveal mt-12 flex flex-wrap items-center justify-center gap-3 border-t-2 border-ink pt-10"
      >
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
