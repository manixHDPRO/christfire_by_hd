import { ChevronDown, ChevronLeft, ChevronRight } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

export type SubcategoryOption = { code: string; label: string };

const LIST_PAGE_SIZE = 20;

type Props = {
  id: string;
  value: string;
  onChange: (code: string) => void;
  options: SubcategoryOption[];
  disabled?: boolean;
  /** Quand la catégorie change, réinitialise l’UI interne */
  categoryKey?: string;
};

export function SubcategoryCombobox({ id, value, onChange, options, disabled, categoryKey }: Props) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [listPage, setListPage] = useState(1);
  const rootRef = useRef<HTMLDivElement>(null);
  const prevOpenRef = useRef(false);

  useEffect(() => {
    setOpen(false);
    setQ("");
    setListPage(1);
  }, [categoryKey]);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  const filtered = useMemo(() => {
    const n = q.trim().toLowerCase();
    if (!n) return options;
    return options.filter(
      (o) => o.label.toLowerCase().includes(n) || o.code.toLowerCase().includes(n),
    );
  }, [options, q]);

  const listTotalPages = Math.max(1, Math.ceil(filtered.length / LIST_PAGE_SIZE));
  const pagedFiltered = useMemo(() => {
    const start = (listPage - 1) * LIST_PAGE_SIZE;
    return filtered.slice(start, start + LIST_PAGE_SIZE);
  }, [filtered, listPage]);

  useEffect(() => {
    setListPage(1);
  }, [q]);

  useEffect(() => {
    setListPage((p) => Math.min(Math.max(1, p), listTotalPages));
  }, [listTotalPages]);

  useEffect(() => {
    const wasOpen = prevOpenRef.current;
    prevOpenRef.current = open;
    if (!open || wasOpen) return;
    if (!value) {
      setListPage(1);
      return;
    }
    const idx = filtered.findIndex((o) => o.code === value);
    if (idx < 0) {
      setListPage(1);
      return;
    }
    setListPage(Math.floor(idx / LIST_PAGE_SIZE) + 1);
  }, [open, value, filtered]);

  const listRangeFrom = filtered.length === 0 ? 0 : (listPage - 1) * LIST_PAGE_SIZE + 1;
  const listRangeTo = Math.min(listPage * LIST_PAGE_SIZE, filtered.length);

  const selected = value === "" ? null : options.find((o) => o.code === value);
  const displaySummary =
    value === "" ? "— Aucune —" : (selected?.label ?? value);

  return (
    <div ref={rootRef} className="relative isolate">
      <button
        id={id}
        type="button"
        disabled={disabled}
        aria-expanded={open}
        aria-haspopup="listbox"
        onClick={() => {
          if (!disabled) setOpen((v) => !v);
        }}
        className="flex w-full items-center justify-between gap-2 rounded-xl border border-white/15 bg-black/30 px-3 py-2 text-left text-sm text-white outline-none focus:ring-2 focus:ring-brand-orange/40 disabled:cursor-not-allowed disabled:opacity-50"
      >
        <span className="min-w-0 flex-1 truncate">{displaySummary}</span>
        <ChevronDown className={`h-4 w-4 shrink-0 text-white/45 transition-transform ${open ? "rotate-180" : ""}`} aria-hidden />
      </button>
      {open && !disabled ? (
        <div className="absolute left-0 right-0 z-[200] mt-1 overflow-hidden rounded-xl border border-white/25 bg-zinc-950 shadow-[0_12px_48px_rgba(0,0,0,0.92)]">
          <input
            type="text"
            role="searchbox"
            aria-label="Filtrer les sous-catégories"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Rechercher…"
            className="w-full border-b border-white/15 bg-zinc-900 px-3 py-2.5 text-sm text-white placeholder:text-white/45 outline-none focus:ring-2 focus:ring-inset focus:ring-brand-orange/35"
            autoComplete="off"
            autoCorrect="off"
            spellCheck={false}
            autoFocus
          />
          <ul className="max-h-52 overflow-y-auto bg-zinc-950 py-1">
            <li role="presentation">
              <button
                type="button"
                role="option"
                aria-selected={value === ""}
                onClick={() => {
                  onChange("");
                  setOpen(false);
                }}
                className={`flex w-full px-3 py-2.5 text-left text-sm transition-colors hover:bg-zinc-800 ${
                  value === "" ? "bg-brand-orange/25 text-brand-cream" : "text-white"
                }`}
              >
                — Aucune —
              </button>
            </li>
            {filtered.length === 0 ? (
              <li className="px-3 py-4 text-center text-xs text-white/50">Aucun résultat.</li>
            ) : (
              pagedFiltered.map((o) => (
                <li key={o.code} role="presentation">
                  <button
                    type="button"
                    role="option"
                    aria-selected={value === o.code}
                    onClick={() => {
                      onChange(o.code);
                      setOpen(false);
                    }}
                    className={`flex w-full px-3 py-2.5 text-left text-sm font-medium text-white transition-colors hover:bg-zinc-800 ${
                      value === o.code ? "bg-brand-orange/25 text-brand-cream" : ""
                    }`}
                  >
                    {o.label}
                  </button>
                </li>
              ))
            )}
          </ul>
          {filtered.length > LIST_PAGE_SIZE ? (
            <div className="flex items-center justify-between gap-2 border-t border-white/15 bg-zinc-900 px-2 py-1.5">
              <span className="min-w-0 truncate pl-1 text-[10px] text-white/45">
                <span className="tabular-nums">{listRangeFrom}</span>–<span className="tabular-nums">{listRangeTo}</span>{" "}
                sur <span className="tabular-nums">{filtered.length}</span> · p.{" "}
                <span className="tabular-nums">{listPage}</span>/<span className="tabular-nums">{listTotalPages}</span>
              </span>
              <div className="flex shrink-0 items-center gap-0.5">
                <button
                  type="button"
                  aria-label="Page précédente"
                  disabled={listPage <= 1}
                  onClick={() => setListPage((p) => Math.max(1, p - 1))}
                  className="inline-flex rounded-md p-1.5 text-white/70 outline-none hover:bg-white/10 hover:text-white disabled:cursor-not-allowed disabled:opacity-35"
                >
                  <ChevronLeft className="h-4 w-4" aria-hidden />
                </button>
                <button
                  type="button"
                  aria-label="Page suivante"
                  disabled={listPage >= listTotalPages}
                  onClick={() => setListPage((p) => Math.min(listTotalPages, p + 1))}
                  className="inline-flex rounded-md p-1.5 text-white/70 outline-none hover:bg-white/10 hover:text-white disabled:cursor-not-allowed disabled:opacity-35"
                >
                  <ChevronRight className="h-4 w-4" aria-hidden />
                </button>
              </div>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
