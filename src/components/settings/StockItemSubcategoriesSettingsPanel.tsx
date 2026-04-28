import {
  apiGetStockItemCategories,
  apiGetStockItemSubcategories,
  apiPutStockItemSubcategories,
} from "@/lib/api";
import type { StockArticleRefRow, StockArticleSubcategoryRow } from "@/types";
import { motion } from "framer-motion";
import { ChevronLeft, ChevronRight, Plus, Trash2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

const SUBCATEGORIES_TABLE_PAGE_SIZE = 15;

function normalizeStockRefCodeInput(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/[^a-z0-9_]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 64);
}

const CODE_OK = /^[a-z0-9_]{1,64}$/;

type SubDraft = Omit<StockArticleSubcategoryRow, "categoryLabel"> & {
  categoryLabel?: string;
  /** Si true, le code vient de la base et reste inchangé tant que libellé / parent ne sont pas modifiés. */
  codeLocked?: boolean;
};

/** Génère les codes auto : `{code_catégorie}_{slug_libellé}` (+ suffixe numérique si collision). */
function recomputeSubcategoryCodes(rows: SubDraft[]): SubDraft[] {
  const used = new Set<string>();
  const result: SubDraft[] = [];
  for (const r of rows) {
    if (r.codeLocked) {
      if (r.code) used.add(r.code);
      result.push({ ...r });
      continue;
    }
    const labelPart = normalizeStockRefCodeInput(r.label);
    if (!labelPart || !r.categoryCode) {
      result.push({ ...r, code: "" });
      continue;
    }
    const prefix = r.categoryCode;
    let base = normalizeStockRefCodeInput(`${prefix}_${labelPart}`);
    if (!base) {
      result.push({ ...r, code: "" });
      continue;
    }
    let code = base.slice(0, 64);
    let n = 2;
    while (used.has(code)) {
      const suffix = `_${n}`;
      code = (base + suffix).slice(0, 64);
      n += 1;
      if (n > 10_000) break;
    }
    used.add(code);
    result.push({ ...r, code });
  }
  return result;
}

export function StockItemSubcategoriesSettingsPanel({
  readOnly,
  baseId,
}: {
  readOnly: boolean;
  baseId: string;
}) {
  const [categories, setCategories] = useState<StockArticleRefRow[]>([]);
  const [rows, setRows] = useState<SubDraft[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadErr, setLoadErr] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveErr, setSaveErr] = useState<string | null>(null);
  const [savedFlash, setSavedFlash] = useState(false);
  const [listFilter, setListFilter] = useState("");
  const [parentFilter, setParentFilter] = useState("");
  const [tablePage, setTablePage] = useState(1);

  const reload = useCallback(async () => {
    setLoading(true);
    setLoadErr(false);
    const [cats, subs] = await Promise.all([apiGetStockItemCategories(), apiGetStockItemSubcategories()]);
    setLoading(false);
    if (!cats?.categories || !subs?.subcategories) {
      setLoadErr(true);
      setCategories([]);
      setRows([]);
      return;
    }
    setCategories(cats.categories);
    setRows(subs.subcategories.map((r) => ({ ...r, codeLocked: true })));
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const categoryOptions = categories.slice().sort((a, b) => a.sortOrder - b.sortOrder || a.code.localeCompare(b.code));

  const listFilterNorm = listFilter.trim().toLowerCase();

  const displayEntries = useMemo(() => {
    return rows
      .map((row, idx) => ({ row, idx }))
      .filter(({ row }) => {
        if (parentFilter && row.categoryCode !== parentFilter) return false;
        if (!listFilterNorm) return true;
        const catLab = categoryOptions.find((c) => c.code === row.categoryCode)?.label ?? "";
        const hay = `${row.label} ${row.code} ${catLab} ${row.categoryCode}`.toLowerCase();
        return hay.includes(listFilterNorm);
      });
  }, [rows, parentFilter, listFilterNorm, categoryOptions]);

  const groupedForDisplay = useMemo(() => {
    return categoryOptions
      .map((cat) => ({
        cat,
        entries: displayEntries.filter((e) => e.row.categoryCode === cat.code),
      }))
      .filter((g) => g.entries.length > 0);
  }, [displayEntries, categoryOptions]);

  const flatOrderedForTable = useMemo(() => {
    const out: { cat: StockArticleRefRow; row: SubDraft; idx: number }[] = [];
    for (const g of groupedForDisplay) {
      for (const e of g.entries) {
        out.push({ cat: g.cat, row: e.row, idx: e.idx });
      }
    }
    return out;
  }, [groupedForDisplay]);

  const tableTotalRows = flatOrderedForTable.length;
  const tableTotalPages = Math.max(1, Math.ceil(tableTotalRows / SUBCATEGORIES_TABLE_PAGE_SIZE));

  useEffect(() => {
    setTablePage(1);
  }, [listFilter, parentFilter]);

  useEffect(() => {
    setTablePage((p) => Math.min(Math.max(1, p), tableTotalPages));
  }, [tableTotalPages]);

  const pagedGroupedForDisplay = useMemo(() => {
    const start = (tablePage - 1) * SUBCATEGORIES_TABLE_PAGE_SIZE;
    const slice = flatOrderedForTable.slice(start, start + SUBCATEGORIES_TABLE_PAGE_SIZE);
    const groups: { cat: StockArticleRefRow; entries: { row: SubDraft; idx: number }[] }[] = [];
    for (const item of slice) {
      const last = groups[groups.length - 1];
      if (!last || last.cat.code !== item.cat.code) {
        groups.push({ cat: item.cat, entries: [{ row: item.row, idx: item.idx }] });
      } else {
        last.entries.push({ row: item.row, idx: item.idx });
      }
    }
    return groups;
  }, [flatOrderedForTable, tablePage]);

  const tableRangeFrom = tableTotalRows === 0 ? 0 : (tablePage - 1) * SUBCATEGORIES_TABLE_PAGE_SIZE + 1;
  const tableRangeTo = Math.min(tablePage * SUBCATEGORIES_TABLE_PAGE_SIZE, tableTotalRows);

  const addRow = () => {
    const first = categoryOptions[0]?.code ?? "";
    setRows((prev) =>
      recomputeSubcategoryCodes([
        ...prev,
        {
          code: "",
          categoryCode: first,
          categoryLabel: categoryOptions[0]?.label ?? "",
          label: "",
          sortOrder: prev.length,
          active: true,
          codeLocked: false,
        },
      ]),
    );
  };

  const removeRow = (idx: number) => {
    setRows((prev) => recomputeSubcategoryCodes(prev.filter((_, i) => i !== idx)));
  };

  const save = async () => {
    setSaveErr(null);
    setSavedFlash(false);
    const normalized = recomputeSubcategoryCodes(rows).map((r) => ({
      code: normalizeStockRefCodeInput(r.code),
      categoryCode: r.categoryCode,
      label: r.label.trim(),
      sortOrder: r.sortOrder,
      active: r.active,
    }));
    for (const r of normalized) {
      if (!CODE_OK.test(r.code)) {
        setSaveErr("Chaque ligne doit avoir un code technique valide.");
        return;
      }
      if (!r.label) {
        setSaveErr("Le libellé est obligatoire pour chaque sous-catégorie.");
        return;
      }
      if (!categoryOptions.some((c) => c.code === r.categoryCode)) {
        setSaveErr("Catégorie parente inconnue ou liste des catégories non chargée.");
        return;
      }
    }
    if (new Set(normalized.map((r) => r.code)).size !== normalized.length) {
      setSaveErr("Les codes doivent être uniques.");
      return;
    }
    if (normalized.length > 0 && !normalized.some((r) => r.active)) {
      setSaveErr("Si des lignes existent, au moins une sous-catégorie doit rester active.");
      return;
    }
    setSaving(true);
    const res = await apiPutStockItemSubcategories({ subcategories: normalized });
    setSaving(false);
    if (res && "error" in res) {
      if (res.error === "subcategory_in_use" && res.code) {
        setSaveErr(`La sous-catégorie « ${res.code} » est encore utilisée par des articles.`);
      } else if (res.error === "unknown_category") {
        setSaveErr("Une catégorie parente n’existe plus. Rechargez la page.");
      } else if (res.error === "validation_error") {
        setSaveErr("Données invalides.");
      } else {
        setSaveErr("Enregistrement impossible. Réessayez.");
      }
      return;
    }
    if (res?.subcategories) {
      setRows(res.subcategories.map((r) => ({ ...r, codeLocked: true })));
      setSavedFlash(true);
      window.setTimeout(() => setSavedFlash(false), 2500);
    }
  };

  return (
    <motion.div
      key="stock-article-subcategories"
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -4 }}
      transition={{ duration: 0.2 }}
    >
      <div className="mb-4">
        <h2 className="font-display text-xl tracking-wide text-brand-cream/90">Sous-catégories article</h2>
        <p className="mt-1 text-xs text-white/40">
          Rattachez chaque sous-catégorie à une catégorie article (onglet « Catégories article »). Le{" "}
          <strong className="text-white/55">code technique</strong> est généré automatiquement :{" "}
          <span className="font-mono text-white/50">code_catégorie</span> + &quot;_&quot; + libellé normalisé (suffixe{" "}
          <span className="font-mono text-white/50">_2</span>, <span className="font-mono text-white/50">_3</span>… si
          besoin). Modifier le libellé ou la catégorie recalcule le code pour cette ligne.
        </p>
        {loadErr ? (
          <p className="mt-2 rounded-lg border border-brand-orange/30 bg-brand-orange/10 px-3 py-2 text-xs text-brand-cream/95" role="alert">
            Impossible de charger les données (session ou droits).
          </p>
        ) : null}
        {loading ? <p className="mt-2 text-xs text-white/45">Chargement…</p> : null}
        {readOnly ? (
          <p className="mt-2 text-[11px] text-white/35">Lecture seule — enregistrement réservé aux comptes autorisés.</p>
        ) : null}
      </div>

      {categoryOptions.length === 0 && !loading ? (
        <p className="rounded-lg border border-amber-500/25 bg-amber-500/10 px-3 py-2 text-xs text-amber-100/90">
          Définissez d’abord au moins une catégorie article dans l’onglet « Catégories article ».
        </p>
      ) : (
        <>
          <div className="mb-3 flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end">
            <div className="min-w-[200px] flex-1">
              <label
                className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-white/40"
                htmlFor={`${baseId}-sub-filter-search`}
              >
                Rechercher
              </label>
              <input
                id={`${baseId}-sub-filter-search`}
                type="search"
                value={listFilter}
                onChange={(e) => setListFilter(e.target.value)}
                placeholder="Libellé, code ou catégorie…"
                disabled={loading || rows.length === 0}
                className="w-full rounded-xl border border-white/15 bg-black/30 px-3 py-2 text-sm text-white outline-none placeholder:text-white/35 focus:ring-2 focus:ring-brand-orange/40 disabled:opacity-50"
              />
            </div>
            <div className="min-w-[220px]">
              <label
                className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-white/40"
                htmlFor={`${baseId}-sub-filter-parent`}
              >
                Catégorie parente
              </label>
              <select
                id={`${baseId}-sub-filter-parent`}
                value={parentFilter}
                onChange={(e) => setParentFilter(e.target.value)}
                disabled={loading || categoryOptions.length === 0}
                className="w-full rounded-xl border border-white/15 bg-black/30 px-3 py-2 text-sm text-white outline-none focus:ring-2 focus:ring-brand-orange/40 disabled:opacity-50"
              >
                <option value="">Toutes les catégories</option>
                {categoryOptions.map((c) => (
                  <option key={c.code} value={c.code}>
                    {c.label}
                  </option>
                ))}
              </select>
            </div>
          </div>
          {rows.length > 0 ? (
            <p className="mb-2 text-[11px] text-white/40">
              <span className="tabular-nums text-white/55">{displayEntries.length}</span> ligne
              {displayEntries.length !== 1 ? "s" : ""} après filtre sur{" "}
              <span className="tabular-nums text-white/55">{rows.length}</span>
              {displayEntries.length > 0 ? (
                <>
                  {" "}
                  — lignes <span className="tabular-nums text-white/55">{tableRangeFrom}</span> à{" "}
                  <span className="tabular-nums text-white/55">{tableRangeTo}</span> (page{" "}
                  <span className="tabular-nums text-white/55">{tablePage}</span> /{" "}
                  <span className="tabular-nums text-white/55">{tableTotalPages}</span>).
                </>
              ) : null}
            </p>
          ) : null}

          <div className="max-h-[min(70vh,720px)] overflow-y-auto overflow-x-auto rounded-xl border border-white/10">
            {rows.length === 0 && loading ? (
              <p className="px-4 py-10 text-center text-sm text-white/45">Chargement…</p>
            ) : rows.length === 0 ? (
              <p className="px-4 py-8 text-center text-sm text-white/45">
                Aucune sous-catégorie. Ajoutez une ligne ou enregistrez une liste vide.
              </p>
            ) : pagedGroupedForDisplay.length === 0 ? (
              <p className="px-4 py-10 text-center text-sm text-white/45">Aucune ligne ne correspond au filtre.</p>
            ) : (
              pagedGroupedForDisplay.map(({ cat, entries }) => {
                const totalInCategory =
                  groupedForDisplay.find((g) => g.cat.code === cat.code)?.entries.length ?? entries.length;
                return (
                <div key={cat.code} className="border-b border-white/10 last:border-b-0">
                  <div className="sticky top-0 z-[1] flex items-center justify-between gap-2 border-b border-white/10 bg-zinc-950/95 px-4 py-2.5 backdrop-blur-sm">
                    <span className="text-xs font-semibold uppercase tracking-wider text-brand-cream/85">
                      {cat.label}
                    </span>
                    <span
                      className="shrink-0 rounded-md bg-white/10 px-2 py-0.5 font-mono text-[10px] text-white/55"
                      title={
                        entries.length < totalInCategory
                          ? `${entries.length} ligne(s) sur cette page, ${totalInCategory} au total (filtre)`
                          : `${totalInCategory} ligne(s) (filtre)`
                      }
                    >
                      {totalInCategory}
                    </span>
                  </div>
                  <table className="w-full min-w-[720px] text-left text-sm">
                    <thead className="border-b border-white/10 text-[10px] font-semibold uppercase tracking-wider text-white/40">
                      <tr>
                        <th className="px-4 py-2">Catégorie parente</th>
                        <th className="px-4 py-2">Code</th>
                        <th className="px-4 py-2">Libellé</th>
                        <th className="px-4 py-2 text-center">Ordre</th>
                        <th className="px-4 py-2 text-center">Actif</th>
                        <th className="px-4 py-2 text-right"> </th>
                      </tr>
                    </thead>
                    <tbody>
                      {entries.map(({ row: r, idx }) => (
                        <tr
                          key={r.code ? r.code : `draft-${idx}`}
                          className="border-b border-white/5 hover:bg-white/[0.02]"
                        >
                          <td className="px-4 py-2 align-top">
                            <label className="sr-only" htmlFor={`${baseId}-sub-cat-${idx}`}>
                              Catégorie
                            </label>
                            <select
                              id={`${baseId}-sub-cat-${idx}`}
                              value={r.categoryCode}
                              disabled={readOnly || categoryOptions.length === 0}
                              onChange={(e) => {
                                const code = e.target.value;
                                const lab = categoryOptions.find((c) => c.code === code)?.label ?? "";
                                setRows((prev) =>
                                  recomputeSubcategoryCodes(
                                    prev.map((row, i) =>
                                      i === idx
                                        ? { ...row, categoryCode: code, categoryLabel: lab, codeLocked: false }
                                        : row,
                                    ),
                                  ),
                                );
                              }}
                              className="w-full min-w-[140px] rounded-lg border border-white/15 bg-black/30 px-2 py-1.5 text-xs text-white outline-none disabled:opacity-60"
                            >
                              {categoryOptions.map((c) => (
                                <option key={c.code} value={c.code}>
                                  {c.label} ({c.code})
                                </option>
                              ))}
                            </select>
                          </td>
                          <td className="px-4 py-2 align-top">
                            <div
                              className="min-h-[38px] rounded-lg border border-white/10 bg-black/20 px-2 py-1.5 font-mono text-xs text-brand-cream/85"
                              title="Généré à partir de la catégorie parente et du libellé"
                            >
                              {r.code ? (
                                r.code
                              ) : (
                                <span className="text-white/35">— (indiquez un libellé)</span>
                              )}
                            </div>
                          </td>
                          <td className="px-4 py-2 align-top">
                            <input
                              value={r.label}
                              readOnly={readOnly}
                              onChange={(e) => {
                                const v = e.target.value;
                                setRows((prev) =>
                                  recomputeSubcategoryCodes(
                                    prev.map((row, i) =>
                                      i === idx ? { ...row, label: v, codeLocked: false } : row,
                                    ),
                                  ),
                                );
                              }}
                              className="w-full min-w-[140px] rounded-lg border border-white/15 bg-black/30 px-2 py-1.5 text-sm text-white outline-none read-only:opacity-60"
                            />
                          </td>
                          <td className="px-4 py-2 text-center align-top">
                            <input
                              type="number"
                              min={0}
                              value={r.sortOrder}
                              readOnly={readOnly}
                              onChange={(e) => {
                                const n = Number.parseInt(e.target.value, 10);
                                setRows((prev) =>
                                  prev.map((row, i) =>
                                    i === idx ? { ...row, sortOrder: Number.isFinite(n) ? n : 0 } : row,
                                  ),
                                );
                              }}
                              className="w-20 rounded-lg border border-white/15 bg-black/30 px-2 py-1.5 text-center font-mono text-xs text-white outline-none read-only:opacity-60"
                            />
                          </td>
                          <td className="px-4 py-2 text-center align-top">
                            <input
                              type="checkbox"
                              checked={r.active}
                              disabled={readOnly}
                              onChange={(e) => {
                                const checked = e.target.checked;
                                setRows((prev) =>
                                  prev.map((row, i) => (i === idx ? { ...row, active: checked } : row)),
                                );
                              }}
                              className="h-4 w-4 accent-brand-orange"
                            />
                          </td>
                          <td className="px-4 py-2 text-right align-top">
                            {!readOnly ? (
                              <button
                                type="button"
                                onClick={() => removeRow(idx)}
                                className="inline-flex rounded-lg border border-white/10 p-1.5 text-white/50 hover:border-rose-400/40 hover:text-rose-200"
                                title="Retirer la ligne"
                              >
                                <Trash2 className="h-4 w-4" />
                              </button>
                            ) : null}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                );
              })
            )}
          </div>

          {tableTotalRows > SUBCATEGORIES_TABLE_PAGE_SIZE ? (
            <div className="mt-2 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-[11px] text-white/40">
                Pagination : <span className="tabular-nums text-white/55">{tablePage}</span> /{" "}
                <span className="tabular-nums text-white/55">{tableTotalPages}</span> (
                <span className="tabular-nums text-white/55">{SUBCATEGORIES_TABLE_PAGE_SIZE}</span> lignes par page)
              </p>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  disabled={tablePage <= 1}
                  onClick={() => setTablePage((p) => Math.max(1, p - 1))}
                  className="inline-flex items-center gap-1 rounded-lg border border-white/15 bg-black/25 px-3 py-1.5 text-xs font-medium text-white/85 outline-none hover:bg-white/[0.06] disabled:cursor-not-allowed disabled:opacity-40"
                >
                  <ChevronLeft className="h-4 w-4" aria-hidden />
                  Précédent
                </button>
                <button
                  type="button"
                  disabled={tablePage >= tableTotalPages}
                  onClick={() => setTablePage((p) => Math.min(tableTotalPages, p + 1))}
                  className="inline-flex items-center gap-1 rounded-lg border border-white/15 bg-black/25 px-3 py-1.5 text-xs font-medium text-white/85 outline-none hover:bg-white/[0.06] disabled:cursor-not-allowed disabled:opacity-40"
                >
                  Suivant
                  <ChevronRight className="h-4 w-4" aria-hidden />
                </button>
              </div>
            </div>
          ) : null}

          <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
            {!readOnly && categoryOptions.length > 0 ? (
              <button
                type="button"
                onClick={addRow}
                className="inline-flex items-center gap-2 rounded-xl border border-white/15 px-4 py-2 text-xs font-semibold text-white/80 hover:bg-white/[0.06]"
              >
                <Plus className="h-4 w-4" />
                Ajouter une sous-catégorie
              </button>
            ) : null}
            {!readOnly ? (
              <button
                type="button"
                disabled={loading || saving || categoryOptions.length === 0}
                onClick={() => void save()}
                className="rounded-xl bg-gradient-to-r from-brand-red to-brand-red-orange px-5 py-2.5 text-sm font-semibold text-white shadow-glow-sm transition-opacity hover:opacity-95 disabled:cursor-not-allowed disabled:opacity-45"
              >
                {saving ? "Enregistrement…" : "Enregistrer"}
              </button>
            ) : null}
            {savedFlash ? (
              <motion.span
                initial={{ opacity: 0, x: -6 }}
                animate={{ opacity: 1, x: 0 }}
                className="text-xs text-emerald-300/90"
              >
                Référentiel enregistré.
              </motion.span>
            ) : null}
          </div>
        </>
      )}
      {saveErr ? (
        <p className="mt-2 text-xs text-rose-200/90" role="alert">
          {saveErr}
        </p>
      ) : null}
    </motion.div>
  );
}
