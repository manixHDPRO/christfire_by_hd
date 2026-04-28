import { ChevronRight, Home } from "lucide-react";
import { Link } from "react-router-dom";

export function Breadcrumb({ items }: { items: { label: string; to?: string }[] }) {
  return (
    <nav
      className="mb-6 flex flex-wrap items-center gap-1 text-xs text-stone-600 dark:text-white/45"
      aria-label="Fil d'Ariane"
    >
      <Link to="/" className="inline-flex items-center gap-1 hover:text-brand-red dark:hover:text-brand-cream/90">
        <Home className="h-3.5 w-3.5" />
        Accueil
      </Link>
      {items.map((it, i) => (
        <span key={i} className="inline-flex items-center gap-1">
          <ChevronRight className="h-3.5 w-3.5 text-stone-400 dark:text-white/25" />
          {it.to ? (
            <Link to={it.to} className="hover:text-stone-900 dark:hover:text-white/70">
              {it.label}
            </Link>
          ) : (
            <span className="text-stone-800 dark:text-white/70">{it.label}</span>
          )}
        </span>
      ))}
    </nav>
  );
}
