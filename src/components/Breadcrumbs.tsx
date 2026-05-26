import { Fragment } from "react";
import { Link } from "react-router-dom";

interface BreadcrumbEntry {
  label: string;
  to?: string;
}

export function Breadcrumbs({ items }: { items: BreadcrumbEntry[] }) {
  return (
    <nav
      aria-label="Breadcrumb"
      className="mb-6 flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.12em] text-ink-3"
    >
      {items.map((item, index) => (
        <Fragment key={item.label}>
          {index > 0 && <span className="opacity-40">/</span>}
          {item.to ? (
            <Link to={item.to} className="hover:text-ink">
              {item.label}
            </Link>
          ) : (
            <span className="font-medium text-ink">{item.label}</span>
          )}
        </Fragment>
      ))}
    </nav>
  );
}
