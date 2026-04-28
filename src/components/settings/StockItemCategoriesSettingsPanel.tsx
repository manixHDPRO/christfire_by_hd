import { apiGetStockItemCategories, apiPutStockItemCategories } from "@/lib/api";
import type { StockArticleRefRow } from "@/types";
import { motion } from "framer-motion";
import { Plus, Trash2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

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

export function StockItemCategoriesSettingsPanel({
  readOnly,
  baseId,
}: {
  readOnly: boolean;
  baseId: string;
}) {
  const [rows, setRows] = useState<StockArticleRefRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadErr, setLoadErr] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveErr, setSaveErr] = useState<string | null>(null);
  const [savedFlash, setSavedFlash] = useState(false);

  const reload = useCallback(async () => {
    setLoading(true);
    setLoadErr(false);
    const data = await apiGetStockItemCategories();
    setLoading(false);
    if (!data?.categories) {
      setLoadErr(true);
      setRows([]);
      return;
    }
    setRows(data.categories);
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const addRow = () => {
    setRows((prev) => [
      ...prev,
      { code: "", label: "", sortOrder: prev.length, active: true },
    ]);
  };

  const removeRow = (idx: number) => {
    setRows((prev) => prev.filter((_, i) => i !== idx));
  };

  const save = async () => {
    setSaveErr(null);
    setSavedFlash(false);
    const normalized: StockArticleRefRow[] = rows.map((r) => ({
      code: normalizeStockRefCodeInput(r.code),
      label: r.label.trim(),
      sortOrder: r.sortOrder,
      active: r.active,
    }));
    for (const r of normalized) {
      if (!CODE_OK.test(r.code)) {
        setSaveErr("Chaque ligne doit avoir un code technique valide (lettres minuscules, chiffres, _).");
        return;
      }
      if (!r.label) {
        setSaveErr("Le libellé est obligatoire pour chaque catégorie.");
        return;
      }
    }
    if (new Set(normalized.map((r) => r.code)).size !== normalized.length) {
      setSaveErr("Les codes doivent être uniques.");
      return;
    }
    if (!normalized.some((r) => r.active)) {
      setSaveErr("Au moins une catégorie doit rester active.");
      return;
    }
    setSaving(true);
    const res = await apiPutStockItemCategories({ categories: normalized });
    setSaving(false);
    if (res && "error" in res) {
      if (res.error === "category_in_use" && res.code) {
        setSaveErr(`La catégorie « ${res.code} » est encore utilisée par des articles. Réassignez-les avant suppression.`);
      } else if (res.error === "validation_error") {
        setSaveErr("Données invalides. Vérifiez les codes et libellés.");
      } else {
        setSaveErr("Enregistrement impossible. Réessayez.");
      }
      return;
    }
    if (res?.categories) {
      setRows(res.categories);
      setSavedFlash(true);
      window.setTimeout(() => setSavedFlash(false), 2500);
    }
  };

  return (
    <motion.div
      key="stock-article-categories"
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -4 }}
      transition={{ duration: 0.2 }}
    >
      <div className="mb-4">
        <h2 className="font-display text-xl tracking-wide text-brand-cream/90">Catégories article (inventaire)</h2>
        <p className="mt-1 text-xs text-white/40">
          Codes techniques utilisés sur les fiches articles (logistique). Au moins une catégorie active. La suppression
          d’un code n’est possible que si aucun article ne l’utilise.
        </p>
        {loadErr ? (
          <p className="mt-2 rounded-lg border border-brand-orange/30 bg-brand-orange/10 px-3 py-2 text-xs text-brand-cream/95" role="alert">
            Impossible de charger le référentiel (session ou droits « modifier les paramètres »).
          </p>
        ) : null}
        {loading ? <p className="mt-2 text-xs text-white/45">Chargement…</p> : null}
        {readOnly ? (
          <p className="mt-2 text-[11px] text-white/35">Lecture seule — enregistrement réservé aux comptes autorisés.</p>
        ) : null}
      </div>

      <div className="overflow-x-auto rounded-xl border border-white/10">
        <table className="w-full min-w-[640px] text-left text-sm">
          <thead className="border-b border-white/10 text-[10px] font-semibold uppercase tracking-wider text-white/40">
            <tr>
              <th className="px-4 py-3">Code</th>
              <th className="px-4 py-3">Libellé</th>
              <th className="px-4 py-3 text-center">Ordre</th>
              <th className="px-4 py-3 text-center">Actif</th>
              <th className="px-4 py-3 text-right"> </th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && loading ? (
              <tr>
                <td colSpan={5} className="px-4 py-10 text-center text-white/45">
                  Chargement…
                </td>
              </tr>
            ) : (
              rows.map((r, idx) => (
                <tr key={`${r.code || "new"}-${idx}`} className="border-b border-white/5 hover:bg-white/[0.02]">
                  <td className="px-4 py-2 align-top">
                    <label className="sr-only" htmlFor={`${baseId}-cat-code-${idx}`}>
                      Code
                    </label>
                    <input
                      id={`${baseId}-cat-code-${idx}`}
                      value={r.code}
                      readOnly={readOnly}
                      onChange={(e) => {
                        const v = e.target.value;
                        setRows((prev) => prev.map((row, i) => (i === idx ? { ...row, code: v } : row)));
                      }}
                      onBlur={() => {
                        setRows((prev) =>
                          prev.map((row, i) =>
                            i === idx ? { ...row, code: normalizeStockRefCodeInput(row.code) } : row,
                          ),
                        );
                      }}
                      className="w-full min-w-[120px] rounded-lg border border-white/15 bg-black/30 px-2 py-1.5 font-mono text-xs text-white outline-none read-only:opacity-60"
                      placeholder="ex. boissons"
                    />
                  </td>
                  <td className="px-4 py-2 align-top">
                    <label className="sr-only" htmlFor={`${baseId}-cat-label-${idx}`}>
                      Libellé
                    </label>
                    <input
                      id={`${baseId}-cat-label-${idx}`}
                      value={r.label}
                      readOnly={readOnly}
                      onChange={(e) => {
                        const v = e.target.value;
                        setRows((prev) => prev.map((row, i) => (i === idx ? { ...row, label: v } : row)));
                      }}
                      className="w-full min-w-[160px] rounded-lg border border-white/15 bg-black/30 px-2 py-1.5 text-sm text-white outline-none read-only:opacity-60"
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
                          prev.map((row, i) => (i === idx ? { ...row, sortOrder: Number.isFinite(n) ? n : 0 } : row)),
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
                        setRows((prev) => prev.map((row, i) => (i === idx ? { ...row, active: checked } : row)));
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
              ))
            )}
          </tbody>
        </table>
      </div>

      <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
        {!readOnly ? (
          <button
            type="button"
            onClick={addRow}
            className="inline-flex items-center gap-2 rounded-xl border border-white/15 px-4 py-2 text-xs font-semibold text-white/80 hover:bg-white/[0.06]"
          >
            <Plus className="h-4 w-4" />
            Ajouter une catégorie
          </button>
        ) : null}
        {!readOnly ? (
          <button
            type="button"
            disabled={loading || saving}
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
      {saveErr ? (
        <p className="mt-2 text-xs text-rose-200/90" role="alert">
          {saveErr}
        </p>
      ) : null}
    </motion.div>
  );
}
