import { MessageDialog } from "@/components/ui/MessageDialog";
import { apiInventoryPutReorderPolicies, apiInventoryReorderPolicies } from "@/lib/api";
import type { StockBalanceRow, StockItem, StockLocation } from "@/types";
import { ChevronLeft, ChevronRight, Trash2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

const POLICIES_TABLE_PAGE_SIZE = 10;

function policyKey(itemId: string, locationId: string): string {
  return `${itemId}\t${locationId}`;
}

function parseThresholdInput(raw: string): { ok: true; value: number | null } | { ok: false } {
  const t = raw.replace(/\s/g, "").replace(",", ".").trim();
  if (t === "") return { ok: true, value: null };
  const n = Number(t);
  if (!Number.isFinite(n) || n < 0 || n > 1e12) return { ok: false };
  return { ok: true, value: n };
}

type PolicyDraft = {
  itemId: string;
  locationId: string;
  itemCode: string;
  itemLabel: string;
  locationLabel: string;
  minStr: string;
  maxStr: string;
  reorderStr: string;
  fromServer: boolean;
};

type Props = {
  items: StockItem[];
  locations: StockLocation[];
  balances: StockBalanceRow[];
  refreshSignal: number;
  onPoliciesSaved?: () => void | Promise<void>;
};

export function StockReorderPoliciesPanel({
  items,
  locations,
  balances,
  refreshSignal,
  onPoliciesSaved,
}: Props) {
  const [drafts, setDrafts] = useState<PolicyDraft[]>([]);
  const [removedKeys, setRemovedKeys] = useState<Set<string>>(() => new Set());
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [okFlash, setOkFlash] = useState(false);

  const [addItemId, setAddItemId] = useState("");
  const [addLocId, setAddLocId] = useState("");
  const [addMin, setAddMin] = useState("");
  const [addMax, setAddMax] = useState("");
  const [addReorder, setAddReorder] = useState("");

  const [bulkCategoryCode, setBulkCategoryCode] = useState("");
  const [bulkSelectedIds, setBulkSelectedIds] = useState<string[]>([]);
  const [bulkLocId, setBulkLocId] = useState("");
  const [bulkMin, setBulkMin] = useState("");
  const [bulkMax, setBulkMax] = useState("");
  const [bulkReorder, setBulkReorder] = useState("");
  const [bulkHint, setBulkHint] = useState<string | null>(null);
  const [policiesTablePage, setPoliciesTablePage] = useState(1);
  const [policiesLocationFilterId, setPoliciesLocationFilterId] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setErr(null);
    const pol = await apiInventoryReorderPolicies();
    setLoading(false);
    if (!pol) {
      setErr("Impossible de charger les politiques de seuils (droits ou serveur).");
      setDrafts([]);
      return;
    }
    setDrafts(
      pol
        .slice()
        .sort(
          (a, b) =>
            a.locationLabel.localeCompare(b.locationLabel, "fr") ||
            a.itemLabel.localeCompare(b.itemLabel, "fr"),
        )
        .map((r) => ({
          itemId: r.itemId,
          locationId: r.locationId,
          itemCode: r.itemCode,
          itemLabel: r.itemLabel,
          locationLabel: r.locationLabel,
          minStr: r.minQty == null ? "" : String(r.minQty),
          maxStr: r.maxQty == null ? "" : String(r.maxQty),
          reorderStr: r.reorderPoint == null ? "" : String(r.reorderPoint),
          fromServer: true,
        })),
    );
    setRemovedKeys(new Set());
    setPoliciesTablePage(1);
    setPoliciesLocationFilterId("");
  }, []);

  useEffect(() => {
    void load();
  }, [load, refreshSignal]);

  const balanceByKey = useMemo(() => {
    const m = new Map<string, number>();
    for (const b of balances) {
      m.set(policyKey(b.itemId, b.locationId), b.qty);
    }
    return m;
  }, [balances]);

  const sortedItems = useMemo(() => {
    return items.filter((i) => i.active).sort((a, b) => a.label.localeCompare(b.label, "fr"));
  }, [items]);

  const sortedLocations = useMemo(() => {
    return locations
      .filter((l) => l.active)
      .sort((a, b) => a.sortOrder - b.sortOrder || a.label.localeCompare(b.label, "fr"));
  }, [locations]);

  const filteredPolicyDrafts = useMemo(() => {
    if (!policiesLocationFilterId) return drafts;
    return drafts.filter((d) => d.locationId === policiesLocationFilterId);
  }, [drafts, policiesLocationFilterId]);

  const policiesTotalPages = Math.max(
    1,
    Math.ceil(filteredPolicyDrafts.length / POLICIES_TABLE_PAGE_SIZE),
  );
  const pagedDrafts = useMemo(() => {
    const start = (policiesTablePage - 1) * POLICIES_TABLE_PAGE_SIZE;
    return filteredPolicyDrafts.slice(start, start + POLICIES_TABLE_PAGE_SIZE);
  }, [filteredPolicyDrafts, policiesTablePage]);

  useEffect(() => {
    if (policiesTablePage > policiesTotalPages) {
      setPoliciesTablePage(policiesTotalPages);
    }
  }, [policiesTablePage, policiesTotalPages]);

  useEffect(() => {
    setPoliciesTablePage(1);
  }, [policiesLocationFilterId]);

  const policiesRangeFrom =
    filteredPolicyDrafts.length === 0
      ? 0
      : (policiesTablePage - 1) * POLICIES_TABLE_PAGE_SIZE + 1;
  const policiesRangeTo = Math.min(
    policiesTablePage * POLICIES_TABLE_PAGE_SIZE,
    filteredPolicyDrafts.length,
  );

  const categoriesForBulk = useMemo(() => {
    const map = new Map<string, string>();
    for (const it of sortedItems) {
      if (!map.has(it.category)) map.set(it.category, it.categoryLabel ?? it.category);
    }
    return [...map.entries()].sort((a, b) => a[1].localeCompare(b[1], "fr"));
  }, [sortedItems]);

  const itemsInBulkCategory = useMemo(() => {
    if (!bulkCategoryCode) return [];
    return sortedItems.filter((it) => it.category === bulkCategoryCode);
  }, [sortedItems, bulkCategoryCode]);

  useEffect(() => {
    setBulkSelectedIds([]);
  }, [bulkCategoryCode]);

  const toggleBulkItem = useCallback((itemId: string) => {
    setBulkSelectedIds((prev) =>
      prev.includes(itemId) ? prev.filter((id) => id !== itemId) : [...prev, itemId],
    );
  }, []);

  const selectAllBulkInCategory = useCallback(() => {
    setBulkSelectedIds(itemsInBulkCategory.map((it) => it.id));
  }, [itemsInBulkCategory]);

  const clearBulkSelection = useCallback(() => {
    setBulkSelectedIds([]);
  }, []);

  const updateDraft = useCallback((key: string, field: "minStr" | "maxStr" | "reorderStr", value: string) => {
    setDrafts((prev) =>
      prev.map((d) => (policyKey(d.itemId, d.locationId) === key ? { ...d, [field]: value } : d)),
    );
  }, []);

  const removeDraft = useCallback((d: PolicyDraft) => {
    const k = policyKey(d.itemId, d.locationId);
    setDrafts((prev) => prev.filter((x) => policyKey(x.itemId, x.locationId) !== k));
    if (d.fromServer) {
      setRemovedKeys((prev) => new Set(prev).add(k));
    }
  }, []);

  const addPolicyRow = useCallback(() => {
    setErr(null);
    if (!addItemId || !addLocId) {
      setErr("Choisissez un article et un lieu.");
      return;
    }
    const k = policyKey(addItemId, addLocId);
    if (drafts.some((d) => policyKey(d.itemId, d.locationId) === k)) {
      setErr("Cette combinaison article / lieu existe déjà dans le tableau.");
      return;
    }
    if (removedKeys.has(k)) {
      setRemovedKeys((prev) => {
        const n = new Set(prev);
        n.delete(k);
        return n;
      });
    }
    const it = items.find((i) => i.id === addItemId);
    const loc = locations.find((l) => l.id === addLocId);
    if (!it || !loc) {
      setErr("Article ou lieu introuvable.");
      return;
    }
    const minP = parseThresholdInput(addMin);
    const maxP = parseThresholdInput(addMax);
    const reP = parseThresholdInput(addReorder);
    if (!minP.ok || !maxP.ok || !reP.ok) {
      setErr("Seuils invalides (nombres ≥ 0).");
      return;
    }
    if (minP.value == null && maxP.value == null && reP.value == null) {
      setErr("Renseignez au moins un seuil (min, max ou point de commande).");
      return;
    }
    if (minP.value != null && maxP.value != null && maxP.value < minP.value) {
      setErr("Le plafond (max) doit être ≥ au plancher (min).");
      return;
    }
    if (reP.value != null && minP.value != null && reP.value < minP.value) {
      setErr("Le point de commande doit être ≥ au stock min.");
      return;
    }
    setDrafts((prev) =>
      [
        ...prev,
        {
          itemId: it.id,
          locationId: loc.id,
          itemCode: it.code,
          itemLabel: it.label,
          locationLabel: loc.label,
          minStr: addMin.trim(),
          maxStr: addMax.trim(),
          reorderStr: addReorder.trim(),
          fromServer: false,
        },
      ].sort(
        (a, b) =>
          a.locationLabel.localeCompare(b.locationLabel, "fr") ||
          a.itemLabel.localeCompare(b.itemLabel, "fr"),
      ),
    );
    setAddMin("");
    setAddMax("");
    setAddReorder("");
    setErr(null);
  }, [addItemId, addLocId, addMin, addMax, addReorder, drafts, removedKeys, items, locations]);

  const applyBulkThresholds = useCallback(() => {
    setErr(null);
    setBulkHint(null);
    if (!bulkCategoryCode) {
      setErr("Choisissez une catégorie pour afficher et sélectionner les articles.");
      return;
    }
    if (!bulkLocId) {
      setErr("Choisissez un lieu pour l’application groupée.");
      return;
    }
    if (bulkSelectedIds.length === 0) {
      setErr("Cochez au moins un article dans la catégorie.");
      return;
    }
    const validIds = bulkSelectedIds.filter((id) => {
      const it = items.find((i) => i.id === id);
      return it != null && it.category === bulkCategoryCode;
    });
    if (validIds.length === 0) {
      setErr("Aucun article coché ne correspond à la catégorie choisie.");
      return;
    }
    const loc = locations.find((l) => l.id === bulkLocId);
    if (!loc) {
      setErr("Lieu introuvable.");
      return;
    }
    const minP = parseThresholdInput(bulkMin);
    const maxP = parseThresholdInput(bulkMax);
    const reP = parseThresholdInput(bulkReorder);
    if (!minP.ok || !maxP.ok || !reP.ok) {
      setErr("Seuils invalides (nombres ≥ 0).");
      return;
    }
    if (minP.value == null && maxP.value == null && reP.value == null) {
      setErr("Renseignez au moins un seuil (min, max ou point de commande).");
      return;
    }
    if (minP.value != null && maxP.value != null && maxP.value < minP.value) {
      setErr("Le plafond (max) doit être ≥ au plancher (min).");
      return;
    }
    if (reP.value != null && minP.value != null && reP.value < minP.value) {
      setErr("Le point de commande doit être ≥ au stock min.");
      return;
    }

    const minStr = bulkMin.trim();
    const maxStr = bulkMax.trim();
    const reorderStr = bulkReorder.trim();

    setDrafts((prev) => {
      const map = new Map<string, PolicyDraft>();
      for (const d of prev) {
        map.set(policyKey(d.itemId, d.locationId), { ...d });
      }
      for (const itemId of validIds) {
        const it = items.find((i) => i.id === itemId);
        if (!it) continue;
        const k = policyKey(it.id, bulkLocId);
        const existing = map.get(k);
        map.set(k, {
          itemId: it.id,
          locationId: loc.id,
          itemCode: it.code,
          itemLabel: it.label,
          locationLabel: loc.label,
          minStr,
          maxStr,
          reorderStr,
          fromServer: existing?.fromServer ?? false,
        });
      }
      return Array.from(map.values()).sort(
        (a, b) =>
          a.locationLabel.localeCompare(b.locationLabel, "fr") ||
          a.itemLabel.localeCompare(b.itemLabel, "fr"),
      );
    });

    setRemovedKeys((prev) => {
      const n = new Set(prev);
      for (const itemId of validIds) {
        n.delete(policyKey(itemId, bulkLocId));
      }
      return n;
    });

    setBulkHint(
      `${validIds.length} politique(s) préparée(s) pour ce lieu — enregistrez pour les envoyer au serveur.`,
    );
  }, [
    bulkCategoryCode,
    bulkLocId,
    bulkSelectedIds,
    bulkMin,
    bulkMax,
    bulkReorder,
    items,
    locations,
  ]);

  const saveAll = useCallback(async () => {
    setErr(null);
    const policies: {
      itemId: string;
      locationId: string;
      minQty: number | null;
      maxQty: number | null;
      reorderPoint: number | null;
    }[] = [];

    for (const d of drafts) {
      const minP = parseThresholdInput(d.minStr);
      const maxP = parseThresholdInput(d.maxStr);
      const reP = parseThresholdInput(d.reorderStr);
      if (!minP.ok || !maxP.ok || !reP.ok) {
        setErr(`Seuils invalides pour ${d.itemCode} @ ${d.locationLabel}.`);
        return;
      }
      const minQty = minP.value;
      const maxQty = maxP.value;
      const reorderPoint = reP.value;
      if (minQty == null && maxQty == null && reorderPoint == null) {
        if (d.fromServer) {
          policies.push({
            itemId: d.itemId,
            locationId: d.locationId,
            minQty: null,
            maxQty: null,
            reorderPoint: null,
          });
        }
        continue;
      }
      if (minQty != null && maxQty != null && maxQty < minQty) {
        setErr(`Plafond < plancher pour ${d.itemCode} @ ${d.locationLabel}.`);
        return;
      }
      if (reorderPoint != null && minQty != null && reorderPoint < minQty) {
        setErr(`Point de commande < min pour ${d.itemCode} @ ${d.locationLabel}.`);
        return;
      }
      policies.push({
        itemId: d.itemId,
        locationId: d.locationId,
        minQty,
        maxQty,
        reorderPoint,
      });
    }

    for (const key of removedKeys) {
      const [itemId, locationId] = key.split("\t");
      if (itemId && locationId) {
        policies.push({
          itemId,
          locationId,
          minQty: null,
          maxQty: null,
          reorderPoint: null,
        });
      }
    }

    if (policies.length > 500) {
      setErr("Trop de lignes à enregistrer d’un coup (max. 500).");
      return;
    }

    setSaving(true);
    const res = await apiInventoryPutReorderPolicies({ policies });
    setSaving(false);
    if (!res.ok) {
      setErr(
        res.code === "validation_error"
          ? "Données rejetées (vérifiez min ≤ max, point de commande ≥ min)."
          : res.code === "invalid_item_or_location"
            ? "Article ou lieu invalide."
            : "Enregistrement impossible.",
      );
      return;
    }
    setOkFlash(true);
    setBulkHint(null);
    await load();
    await onPoliciesSaved?.();
  }, [drafts, removedKeys, load, onPoliciesSaved]);

  const panelDialogMessage =
    err ?? bulkHint ?? (okFlash ? "Politiques enregistrées." : null) ?? "";
  const panelDialogVariant = err ? "error" : okFlash ? "success" : "info";
  const closePanelDialog = () => {
    setErr(null);
    setBulkHint(null);
    setOkFlash(false);
  };

  return (
    <div className="mt-6 space-y-4">
      <MessageDialog
        open={!!(err || bulkHint || okFlash)}
        message={panelDialogMessage}
        variant={panelDialogVariant}
        onClose={closePanelDialog}
      />

      <div>
        <h3 className="font-display text-base text-brand-cream/95">Politiques par article et lieu</h3>
        <p className="mt-1 text-[11px] text-white/40">
          Renseignez au moins un des trois seuils. Laissez vide pour ne pas utiliser une borne. Les alertes et
          l’onglet « À commander » s’appuient sur ces règles.
        </p>
      </div>

      <div className="rounded-xl border border-white/10 bg-black/20 p-4">
        <p className="mb-3 text-[10px] font-semibold uppercase tracking-wider text-white/40">
          Application groupée par catégorie
        </p>
        <p className="mb-3 text-[11px] text-white/35">
          Choisissez une catégorie, cochez plusieurs articles, un lieu et les seuils identiques — les lignes sont
          ajoutées ou mises à jour dans le tableau (puis cliquez sur « Enregistrer les politiques »).
        </p>
        <div className="flex flex-col gap-4 lg:flex-row">
          <div className="min-w-0 flex-1 space-y-3">
            <div>
              <label
                htmlFor="policy-bulk-cat"
                className="mb-1 block text-[10px] font-semibold uppercase text-white/40"
              >
                Catégorie
              </label>
              <select
                id="policy-bulk-cat"
                value={bulkCategoryCode}
                onChange={(e) => setBulkCategoryCode(e.target.value)}
                disabled={loading || categoriesForBulk.length === 0}
                className="w-full rounded-xl border border-white/15 bg-black/30 px-3 py-2 text-sm text-white outline-none focus:ring-2 focus:ring-brand-orange/40 disabled:opacity-50"
              >
                <option value="">— Choisir une catégorie —</option>
                {categoriesForBulk.map(([code, label]) => (
                  <option key={code} value={code}>
                    {label}
                  </option>
                ))}
              </select>
            </div>
            {bulkCategoryCode ? (
              <div>
                <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                  <span className="text-[10px] font-semibold uppercase text-white/40">
                    Articles ({bulkSelectedIds.length} / {itemsInBulkCategory.length})
                  </span>
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => selectAllBulkInCategory()}
                      disabled={itemsInBulkCategory.length === 0}
                      className="text-[10px] font-semibold uppercase tracking-wide text-brand-cream/80 hover:text-brand-cream disabled:opacity-40"
                    >
                      Tout sélectionner
                    </button>
                    <button
                      type="button"
                      onClick={() => clearBulkSelection()}
                      disabled={bulkSelectedIds.length === 0}
                      className="text-[10px] font-semibold uppercase tracking-wide text-white/45 hover:text-white/70 disabled:opacity-40"
                    >
                      Effacer
                    </button>
                  </div>
                </div>
                <div
                  role="group"
                  aria-label="Articles de la catégorie"
                  className="max-h-52 space-y-1 overflow-y-auto rounded-lg border border-white/10 bg-black/25 p-2"
                >
                  {itemsInBulkCategory.length === 0 ? (
                    <p className="px-2 py-4 text-center text-xs text-white/40">Aucun article actif dans cette catégorie.</p>
                  ) : (
                    itemsInBulkCategory.map((it) => (
                      <label
                        key={it.id}
                        className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 hover:bg-white/[0.06]"
                      >
                        <input
                          type="checkbox"
                          checked={bulkSelectedIds.includes(it.id)}
                          onChange={() => toggleBulkItem(it.id)}
                          className="h-4 w-4 accent-brand-orange"
                        />
                        <span className="min-w-0 flex-1 truncate text-sm text-white/85">{it.label}</span>
                        <span className="shrink-0 font-mono text-[10px] text-white/40">{it.code}</span>
                      </label>
                    ))
                  )}
                </div>
              </div>
            ) : (
              <p className="text-xs text-white/35">Sélectionnez une catégorie pour afficher la liste des articles.</p>
            )}
          </div>
          <div className="flex min-w-[240px] flex-1 flex-col gap-3 lg:max-w-md">
            <div>
              <label htmlFor="policy-bulk-loc" className="mb-1 block text-[10px] font-semibold uppercase text-white/40">
                Lieu
              </label>
              <select
                id="policy-bulk-loc"
                value={bulkLocId}
                onChange={(e) => setBulkLocId(e.target.value)}
                disabled={loading || sortedLocations.length === 0}
                className="w-full rounded-xl border border-white/15 bg-black/30 px-3 py-2 text-sm text-white outline-none focus:ring-2 focus:ring-brand-orange/40 disabled:opacity-50"
              >
                <option value="">— Choisir —</option>
                {sortedLocations.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="grid grid-cols-3 gap-2">
              <div>
                <label htmlFor="policy-bulk-min" className="mb-1 block text-[10px] font-semibold uppercase text-white/40">
                  Min
                </label>
                <input
                  id="policy-bulk-min"
                  type="text"
                  inputMode="decimal"
                  value={bulkMin}
                  onChange={(e) => setBulkMin(e.target.value)}
                  placeholder="—"
                  className="w-full rounded-xl border border-white/15 bg-black/30 px-2 py-2 font-mono text-xs text-white outline-none focus:ring-2 focus:ring-brand-orange/40"
                />
              </div>
              <div>
                <label htmlFor="policy-bulk-max" className="mb-1 block text-[10px] font-semibold uppercase text-white/40">
                  Max
                </label>
                <input
                  id="policy-bulk-max"
                  type="text"
                  inputMode="decimal"
                  value={bulkMax}
                  onChange={(e) => setBulkMax(e.target.value)}
                  placeholder="—"
                  className="w-full rounded-xl border border-white/15 bg-black/30 px-2 py-2 font-mono text-xs text-white outline-none focus:ring-2 focus:ring-brand-orange/40"
                />
              </div>
              <div>
                <label
                  htmlFor="policy-bulk-reorder"
                  className="mb-1 block text-[10px] font-semibold uppercase text-white/40"
                >
                  Pt cmd.
                </label>
                <input
                  id="policy-bulk-reorder"
                  type="text"
                  inputMode="decimal"
                  value={bulkReorder}
                  onChange={(e) => setBulkReorder(e.target.value)}
                  placeholder="—"
                  className="w-full rounded-xl border border-white/15 bg-black/30 px-2 py-2 font-mono text-xs text-white outline-none focus:ring-2 focus:ring-brand-orange/40"
                />
              </div>
            </div>
            <button
              type="button"
              disabled={
                loading ||
                !bulkCategoryCode ||
                sortedLocations.length === 0 ||
                itemsInBulkCategory.length === 0
              }
              onClick={() => applyBulkThresholds()}
              className="w-full rounded-xl border border-brand-orange/35 bg-brand-orange/15 px-4 py-2.5 text-sm font-semibold text-brand-cream hover:bg-brand-orange/25 disabled:opacity-40"
            >
              Appliquer le seuil aux articles cochés
            </button>
          </div>
        </div>
      </div>

      <div className="rounded-xl border border-white/10 bg-black/20 p-4">
        <p className="mb-3 text-[10px] font-semibold uppercase tracking-wider text-white/40">
          Ajouter une politique (un seul article)
        </p>
        <div className="flex flex-col gap-3 lg:flex-row lg:flex-wrap lg:items-end">
          <div className="min-w-[200px] flex-1">
            <label htmlFor="policy-add-item" className="mb-1 block text-[10px] font-semibold uppercase text-white/40">
              Article
            </label>
            <select
              id="policy-add-item"
              value={addItemId}
              onChange={(e) => setAddItemId(e.target.value)}
              disabled={loading || sortedItems.length === 0}
              className="w-full rounded-xl border border-white/15 bg-black/30 px-3 py-2 text-sm text-white outline-none focus:ring-2 focus:ring-brand-orange/40 disabled:opacity-50"
            >
              <option value="">— Choisir —</option>
              {sortedItems.map((it) => (
                <option key={it.id} value={it.id}>
                  {it.label} ({it.code})
                </option>
              ))}
            </select>
          </div>
          <div className="min-w-[200px] flex-1">
            <label htmlFor="policy-add-loc" className="mb-1 block text-[10px] font-semibold uppercase text-white/40">
              Lieu
            </label>
            <select
              id="policy-add-loc"
              value={addLocId}
              onChange={(e) => setAddLocId(e.target.value)}
              disabled={loading || sortedLocations.length === 0}
              className="w-full rounded-xl border border-white/15 bg-black/30 px-3 py-2 text-sm text-white outline-none focus:ring-2 focus:ring-brand-orange/40 disabled:opacity-50"
            >
              <option value="">— Choisir —</option>
              {sortedLocations.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.label}
                </option>
              ))}
            </select>
          </div>
          <div className="w-full min-w-[100px] sm:w-auto">
            <label htmlFor="policy-add-min" className="mb-1 block text-[10px] font-semibold uppercase text-white/40">
              Min
            </label>
            <input
              id="policy-add-min"
              type="text"
              inputMode="decimal"
              value={addMin}
              onChange={(e) => setAddMin(e.target.value)}
              placeholder="—"
              className="w-full rounded-xl border border-white/15 bg-black/30 px-3 py-2 font-mono text-sm text-white outline-none focus:ring-2 focus:ring-brand-orange/40"
            />
          </div>
          <div className="w-full min-w-[100px] sm:w-auto">
            <label htmlFor="policy-add-max" className="mb-1 block text-[10px] font-semibold uppercase text-white/40">
              Max
            </label>
            <input
              id="policy-add-max"
              type="text"
              inputMode="decimal"
              value={addMax}
              onChange={(e) => setAddMax(e.target.value)}
              placeholder="—"
              className="w-full rounded-xl border border-white/15 bg-black/30 px-3 py-2 font-mono text-sm text-white outline-none focus:ring-2 focus:ring-brand-orange/40"
            />
          </div>
          <div className="w-full min-w-[100px] sm:w-auto">
            <label
              htmlFor="policy-add-reorder"
              className="mb-1 block text-[10px] font-semibold uppercase text-white/40"
            >
              Point cmd.
            </label>
            <input
              id="policy-add-reorder"
              type="text"
              inputMode="decimal"
              value={addReorder}
              onChange={(e) => setAddReorder(e.target.value)}
              placeholder="—"
              className="w-full rounded-xl border border-white/15 bg-black/30 px-3 py-2 font-mono text-sm text-white outline-none focus:ring-2 focus:ring-brand-orange/40"
            />
          </div>
          <button
            type="button"
            disabled={loading || sortedItems.length === 0 || sortedLocations.length === 0}
            onClick={() => addPolicyRow()}
            className="rounded-xl border border-white/15 px-4 py-2 text-xs font-semibold text-white/85 hover:bg-white/[0.06] disabled:opacity-40"
          >
            Ajouter au tableau
          </button>
        </div>
      </div>

      {loading ? (
        <p className="text-sm text-white/45">Chargement des politiques…</p>
      ) : (
        <div className="overflow-hidden rounded-xl border border-white/10">
          {drafts.length > 0 ? (
            <div className="flex flex-col gap-2 border-b border-white/10 px-3 py-2.5 sm:flex-row sm:flex-wrap sm:items-end sm:gap-4">
              <div className="min-w-[200px] flex-1 sm:max-w-xs">
                <label
                  htmlFor="policy-table-loc-filter"
                  className="mb-1 block text-[10px] font-semibold uppercase text-white/40"
                >
                  Lieu de stockage
                </label>
                <select
                  id="policy-table-loc-filter"
                  value={policiesLocationFilterId}
                  onChange={(e) => setPoliciesLocationFilterId(e.target.value)}
                  disabled={loading || sortedLocations.length === 0}
                  className="w-full rounded-xl border border-white/15 bg-black/30 px-3 py-2 text-sm text-white outline-none focus:ring-2 focus:ring-brand-orange/40 disabled:opacity-50"
                >
                  <option value="">Tous les lieux</option>
                  {sortedLocations.map((l) => (
                    <option key={l.id} value={l.id}>
                      {l.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          ) : null}
          {filteredPolicyDrafts.length > POLICIES_TABLE_PAGE_SIZE ? (
            <p className="border-b border-white/10 px-3 py-2 text-[11px] text-white/40">
              <span className="tabular-nums text-white/55">{policiesRangeFrom}</span>–
              <span className="tabular-nums text-white/55">{policiesRangeTo}</span> sur{" "}
              <span className="tabular-nums text-white/55">{filteredPolicyDrafts.length}</span> politique
              {filteredPolicyDrafts.length !== 1 ? "s" : ""}
              {policiesLocationFilterId ? (
                <>
                  {" "}
                  affichée{filteredPolicyDrafts.length !== 1 ? "s" : ""} ·{" "}
                  <span className="tabular-nums text-white/55">{drafts.length}</span> au total
                </>
              ) : null}{" "}
              · page{" "}
              <span className="tabular-nums text-white/55">{policiesTablePage}</span> /{" "}
              <span className="tabular-nums text-white/55">{policiesTotalPages}</span>
            </p>
          ) : filteredPolicyDrafts.length > 0 ? (
            <p className="border-b border-white/10 px-3 py-2 text-[11px] text-white/40">
              <span className="tabular-nums text-white/55">{filteredPolicyDrafts.length}</span> politique
              {filteredPolicyDrafts.length !== 1 ? "s" : ""}
              {policiesLocationFilterId ? (
                <>
                  {" "}
                  pour ce lieu ·{" "}
                  <span className="tabular-nums text-white/55">{drafts.length}</span> au total
                </>
              ) : null}
            </p>
          ) : null}
          <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] text-left text-sm">
            <thead className="border-b border-white/10 text-[10px] font-semibold uppercase tracking-wider text-white/40">
              <tr>
                <th className="px-3 py-2">Article</th>
                <th className="px-3 py-2">Lieu</th>
                <th className="px-3 py-2 text-right">Stock</th>
                <th className="px-3 py-2">Min</th>
                <th className="px-3 py-2">Max</th>
                <th className="px-3 py-2">Point cmd.</th>
                <th className="px-3 py-2 text-right"> </th>
              </tr>
            </thead>
            <tbody>
              {drafts.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-3 py-8 text-center text-white/45">
                    Aucune politique. Ajoutez une ligne ci-dessus.
                  </td>
                </tr>
              ) : filteredPolicyDrafts.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-3 py-8 text-center text-white/45">
                    Aucune politique pour ce lieu de stockage. Choisissez un autre lieu ou « Tous les lieux ».
                  </td>
                </tr>
              ) : (
                pagedDrafts.map((d) => {
                  const k = policyKey(d.itemId, d.locationId);
                  const qty = balanceByKey.get(k);
                  return (
                    <tr key={k} className="border-b border-white/5">
                      <td className="px-3 py-2 text-white/80">
                        <span className="font-mono text-xs text-white/50">{d.itemCode}</span> {d.itemLabel}
                      </td>
                      <td className="px-3 py-2 text-white/55">{d.locationLabel}</td>
                      <td className="px-3 py-2 text-right font-mono text-xs text-white/50">
                        {qty !== undefined ? qty.toLocaleString("fr-FR", { maximumFractionDigits: 3 }) : "—"}
                      </td>
                      <td className="px-3 py-2">
                        <input
                          aria-label={`Min ${d.itemCode} ${d.locationLabel}`}
                          type="text"
                          inputMode="decimal"
                          value={d.minStr}
                          onChange={(e) => updateDraft(k, "minStr", e.target.value)}
                          className="w-full min-w-[72px] rounded-lg border border-white/15 bg-black/30 px-2 py-1.5 font-mono text-xs text-white outline-none focus:ring-1 focus:ring-brand-orange/40"
                        />
                      </td>
                      <td className="px-3 py-2">
                        <input
                          aria-label={`Max ${d.itemCode} ${d.locationLabel}`}
                          type="text"
                          inputMode="decimal"
                          value={d.maxStr}
                          onChange={(e) => updateDraft(k, "maxStr", e.target.value)}
                          className="w-full min-w-[72px] rounded-lg border border-white/15 bg-black/30 px-2 py-1.5 font-mono text-xs text-white outline-none focus:ring-1 focus:ring-brand-orange/40"
                        />
                      </td>
                      <td className="px-3 py-2">
                        <input
                          aria-label={`Point de commande ${d.itemCode} ${d.locationLabel}`}
                          type="text"
                          inputMode="decimal"
                          value={d.reorderStr}
                          onChange={(e) => updateDraft(k, "reorderStr", e.target.value)}
                          className="w-full min-w-[72px] rounded-lg border border-white/15 bg-black/30 px-2 py-1.5 font-mono text-xs text-white outline-none focus:ring-1 focus:ring-brand-orange/40"
                        />
                      </td>
                      <td className="px-3 py-2 text-right">
                        <button
                          type="button"
                          onClick={() => removeDraft(d)}
                          className="inline-flex rounded-lg border border-white/10 p-1.5 text-white/45 hover:border-rose-400/35 hover:text-rose-200"
                          title="Retirer la politique"
                          aria-label={`Retirer ${d.itemCode} ${d.locationLabel}`}
                        >
                          <Trash2 className="h-4 w-4" aria-hidden />
                        </button>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
          </div>
          {filteredPolicyDrafts.length > POLICIES_TABLE_PAGE_SIZE ? (
            <div className="flex flex-col gap-2 border-t border-white/10 bg-black/20 px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between">
              <span className="text-[11px] text-white/35">
                {POLICIES_TABLE_PAGE_SIZE} politiques par page
              </span>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  disabled={policiesTablePage <= 1}
                  onClick={() => setPoliciesTablePage((p) => Math.max(1, p - 1))}
                  className="inline-flex items-center gap-1 rounded-lg border border-white/15 bg-black/30 px-3 py-1.5 text-xs font-medium text-white/85 outline-none hover:bg-white/[0.06] disabled:cursor-not-allowed disabled:opacity-40"
                >
                  <ChevronLeft className="h-4 w-4" aria-hidden />
                  Précédent
                </button>
                <button
                  type="button"
                  disabled={policiesTablePage >= policiesTotalPages}
                  onClick={() =>
                    setPoliciesTablePage((p) => Math.min(policiesTotalPages, p + 1))
                  }
                  className="inline-flex items-center gap-1 rounded-lg border border-white/15 bg-black/30 px-3 py-1.5 text-xs font-medium text-white/85 outline-none hover:bg-white/[0.06] disabled:cursor-not-allowed disabled:opacity-40"
                >
                  Suivant
                  <ChevronRight className="h-4 w-4" aria-hidden />
                </button>
              </div>
            </div>
          ) : null}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          disabled={saving || loading}
          onClick={() => void saveAll()}
          className="rounded-xl bg-gradient-to-r from-brand-red to-brand-red-orange px-5 py-2 text-sm font-semibold text-white shadow-glow-sm transition-opacity hover:opacity-95 disabled:cursor-not-allowed disabled:opacity-45"
        >
          {saving ? "Enregistrement…" : "Enregistrer les politiques"}
        </button>
      </div>
    </div>
  );
}
