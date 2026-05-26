import { Menu, Search } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { APP_DESCRIPTION, APP_NAME } from "../config";
import { Logo } from "./Logo";
import { PageTransition } from "./PageTransition";
import { SearchModal } from "./SearchModal";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "./ui/sheet";

const primaryNavLinks = [
  { label: "Tools", to: "/tools" },
  { label: "Privacy", to: "/privacy" },
] as const;

function isActive(pathname: string, to: string) {
  if (to === "/") return pathname === "/";
  return pathname === to || pathname.startsWith(`${to}/`);
}

export function Layout() {
  const [searchOpen, setSearchOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const { pathname } = useLocation();

  const openSearch = useCallback(() => setSearchOpen(true), []);
  const closeSearch = useCallback(() => setSearchOpen(false), []);

  const openSearchFromMenu = useCallback(() => {
    setMenuOpen(false);
    setSearchOpen(true);
  }, []);

  useEffect(() => {
    function handleGlobalKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setSearchOpen((prev) => !prev);
      }
    }
    document.addEventListener("keydown", handleGlobalKeyDown);
    return () => document.removeEventListener("keydown", handleGlobalKeyDown);
  }, []);

  return (
    <div className="flex min-h-screen flex-col text-foreground">
      <header className="sticky top-3.5 z-50 mx-auto w-full max-w-[1320px] px-4 sm:px-7">
        <div className="flex items-center justify-between gap-2 rounded-full border-2 border-ink bg-ink py-2 pl-5 pr-2 text-paper shadow-pop-cta">
          <div className="flex items-center gap-4 sm:gap-5">
            <Link to="/" className="flex shrink-0 items-center gap-2.5">
              <span
                className="grid size-7 place-items-center rounded-[8px] border-2 border-ink bg-lemon text-ink"
                style={{ transform: "rotate(-6deg)" }}
              >
                <Logo className="size-3.5" />
              </span>
              <span className="text-[15px] font-bold tracking-tight">{APP_NAME}</span>
            </Link>

            <nav aria-label="Main navigation" className="hidden items-center gap-1 md:flex">
              {primaryNavLinks.map((link) => {
                const active = isActive(pathname, link.to);
                return (
                  <Link
                    key={link.to}
                    to={link.to}
                    className="rounded-full px-3.5 py-2 text-[13px] font-medium transition-[background,opacity,transform] duration-200 hover:opacity-100"
                    style={{
                      background: active ? "rgba(255,255,255,.12)" : "transparent",
                      opacity: active ? 1 : 0.7,
                    }}
                  >
                    {link.label}
                  </Link>
                );
              })}
            </nav>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={openSearch}
              className="hidden items-center gap-2 rounded-full border-2 border-ink bg-lemon px-3.5 py-2 text-[13px] font-semibold text-ink transition-[background,transform] duration-200 hover:-translate-y-px hover:bg-mint sm:inline-flex"
            >
              <Search className="size-3.5" strokeWidth={2.5} />
              <span>Open</span>
              <kbd className="wb-kbd">⌘K</kbd>
            </button>

            <button
              type="button"
              onClick={openSearch}
              aria-label="Search"
              className="grid size-11 place-items-center rounded-full border-2 border-ink bg-lemon text-ink sm:hidden"
            >
              <Search className="size-4" strokeWidth={2.5} />
            </button>

            <Sheet open={menuOpen} onOpenChange={setMenuOpen}>
              <SheetTrigger asChild>
                <button
                  type="button"
                  aria-label="Menu"
                  className="grid size-11 place-items-center rounded-full text-paper transition-opacity hover:opacity-100 md:hidden"
                  style={{ opacity: 0.7 }}
                >
                  <Menu className="size-4" />
                </button>
              </SheetTrigger>
              <SheetContent side="right" className="border-l-2 border-ink">
                <SheetHeader>
                  <SheetTitle>{APP_NAME}</SheetTitle>
                  <SheetDescription className="sr-only">
                    Primary navigation and search
                  </SheetDescription>
                </SheetHeader>
                <nav className="flex flex-col gap-2 pt-4">
                  <button
                    type="button"
                    onClick={openSearchFromMenu}
                    className="flex items-center gap-2 rounded-md px-3 py-2 text-left text-sm font-medium text-foreground transition-colors hover:bg-muted"
                  >
                    <Search className="size-4" />
                    Search tools
                  </button>
                  {primaryNavLinks.map((link) => (
                    <Link
                      key={link.to}
                      to={link.to}
                      onClick={() => setMenuOpen(false)}
                      className="rounded-md px-3 py-2 text-sm font-medium text-foreground transition-colors hover:bg-muted"
                    >
                      {link.label}
                    </Link>
                  ))}
                </nav>
              </SheetContent>
            </Sheet>
          </div>
        </div>
      </header>

      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[100] focus:rounded-lg focus:bg-ink focus:px-4 focus:py-2 focus:text-paper focus:outline-none"
      >
        Skip to main content
      </a>

      <main id="main-content" className="flex-1">
        <PageTransition />
      </main>

      <footer
        className="mt-16 bg-ink text-paper"
        style={{ borderTopLeftRadius: 32, borderTopRightRadius: 32 }}
      >
        <div className="wb-shell py-12 sm:py-14">
          <div className="grid gap-8 md:grid-cols-[1.4fr_1fr_1fr_1fr]">
            <div>
              <h2
                className="wb-display mb-2 text-paper"
                style={{
                  fontSize: "clamp(28px,3.4vw,40px)",
                  lineHeight: 1.05,
                  letterSpacing: "-0.025em",
                }}
              >
                Make something. Locally.
              </h2>
              <p className="mt-4 max-w-[34ch] text-[13.5px] leading-relaxed text-ink-muted">
                {APP_DESCRIPTION}
              </p>
            </div>

            <nav aria-label="Product links">
              <h5 className="wb-meta mb-3.5 text-ink-muted">Product</h5>
              <ul className="flex flex-col gap-2 text-[13.5px]">
                <li>
                  <Link to="/tools" className="text-paper transition-colors hover:text-lemon">
                    All tools
                  </Link>
                </li>
                <li>
                  <Link to="/privacy" className="text-paper transition-colors hover:text-lemon">
                    Privacy
                  </Link>
                </li>
                <li>
                  <Link to="/" className="text-paper transition-colors hover:text-lemon">
                    Homepage
                  </Link>
                </li>
              </ul>
            </nav>

            <nav aria-label="Workflow links">
              <h5 className="wb-meta mb-3.5 text-ink-muted">Workflow</h5>
              <ul className="flex flex-col gap-2 text-[13.5px]">
                <li>
                  <button
                    type="button"
                    onClick={openSearch}
                    className="text-left text-paper transition-colors hover:text-lemon"
                  >
                    ⌘K palette
                  </button>
                </li>
                <li>
                  <Link to="/tools" className="text-paper transition-colors hover:text-lemon">
                    Browse the workbench
                  </Link>
                </li>
                <li>
                  <Link to="/privacy" className="text-paper transition-colors hover:text-lemon">
                    Privacy promise
                  </Link>
                </li>
              </ul>
            </nav>

            <div>
              <h5 className="wb-meta mb-3.5 text-ink-muted">Project</h5>
              <ul className="flex flex-col gap-2 text-[13.5px]">
                <li>
                  <a
                    href="https://github.com/tareqmlx/utilbench/"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-paper transition-colors hover:text-lemon"
                  >
                    GitHub
                  </a>
                </li>
                <li>
                  <a
                    href="https://github.com/tareqmlx/utilbench/blob/main/LICENSE"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-paper transition-colors hover:text-lemon"
                  >
                    MIT licensed
                  </a>
                </li>
              </ul>
              <div className="mt-3 flex flex-wrap gap-2 font-mono text-[10.5px] uppercase tracking-[0.12em] text-ink-muted">
                <span className="rounded-full border border-current px-2 py-0.5">No cookies</span>
                <span className="rounded-full border border-current px-2 py-0.5">No tracking</span>
              </div>
            </div>
          </div>

          <div className="mt-10 flex flex-col gap-2 border-t border-ink-divider pt-5 font-mono text-[11px] uppercase tracking-[0.12em] text-ink-muted sm:flex-row sm:justify-between">
            <span>© 2026 {APP_NAME} · No cookies, no tracking</span>
          </div>
        </div>
      </footer>

      <SearchModal isOpen={searchOpen} onClose={closeSearch} />
    </div>
  );
}
