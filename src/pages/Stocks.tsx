import { useAuth } from "@/auth/AuthContext";
import { Breadcrumb } from "@/components/layout/Breadcrumb";
import {
  apiInventoryAdjustment,
  apiInventoryArticleRefs,
  apiInventoryBalances,
  apiInventoryCount,
  apiInventoryCreateItem,
  apiInventoryCreateSupplier,
  apiInventoryUpdateItem,
  apiInventoryDocuments,
  apiInventoryItems,
  apiInventoryLocations,
  apiInventoryReceipt,
  apiInventoryStockAlerts,
  apiInventorySuppliers,
  apiInventoryToOrder,
  apiInventoryTransfer,
  apiListPurchaseOrdersEligibleForReceipt,
} from "@/lib/api";
import {
  defaultLogistiquePath,
  getLogistiqueAllowedSections,
  logistiqueSectionLabel,
  type LogistiqueSectionId,
} from "@/lib/logistiqueNavBuckets";
import type {
  InventoryArticleRefs,
  PurchaseOrderEligibleForReceipt,
  StockBalanceRow,
  StockDashboardAlert,
  StockDocument,
  StockItem,
  StockLocation,
  StockSupplier,
  StockToOrderLine,
} from "@/types";
import { StockReorderPoliciesPanel } from "@/components/stocks/StockReorderPoliciesPanel";
import { SubcategoryCombobox } from "@/components/stocks/SubcategoryCombobox";
import { MessageDialog } from "@/components/ui/MessageDialog";
import { PurchaseOrdersPanel } from "@/pages/PurchaseOrdersPanel";
import { motion } from "framer-motion";
import type { LucideIcon } from "lucide-react";
import {
  ArrowLeftRight,
  ChevronLeft,
  ChevronRight,
  ClipboardCheck,
  ClipboardList,
  History,
  LayoutDashboard,
  Package,
  PackageOpen,
  Pencil,
  Plus,
  RefreshCw,
  ShoppingCart,
  SlidersHorizontal,
  Truck,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";

type TabId = LogistiqueSectionId;

type SeuilsSubTab = "alertes" | "seuils";

const DOC_LABELS: Record<string, string> = {
  receipt: "Réception (achat)",
  transfer: "Transfert",
  adjustment: "Ajustement",
  inventory: "Inventaire (écart)",
};

function tabFromSection(section: string | undefined, allowed: readonly TabId[]): TabId {
  if (section && (allowed as readonly string[]).includes(section)) return section as TabId;
  return allowed[0] ?? "vue";
}

const STOCKS_TAB_HEADER_META: Record<LogistiqueSectionId, { subtitle: string; Icon: LucideIcon }> = {
  vue: {
    subtitle:
      "Dépôt central, terrasses et restaurant : quantités, emplacements et coût moyen pondéré en CDF.",
    Icon: LayoutDashboard,
  },
  articles: {
    subtitle: "Références actives, unités, catégories et prix de vente.",
    Icon: Package,
  },
  seuils: {
    subtitle: "Alertes actives et définition des seuils min, max et point de commande par article et lieu.",
    Icon: SlidersHorizontal,
  },
  "a-commander": {
    subtitle: "Suggestions de quantités à réapprovisionner selon vos seuils.",
    Icon: ShoppingCart,
  },
  fournisseurs: {
    subtitle: "Annuaire des partenaires et coordonnées utiles aux achats.",
    Icon: Truck,
  },
  commandes: {
    subtitle: "Création, validation et suivi des bons de commande.",
    Icon: ClipboardList,
  },
  reception: {
    subtitle: "Enregistrer les entrées en stock liées aux achats.",
    Icon: PackageOpen,
  },
  transfert: {
    subtitle: "Déplacer des quantités d’un emplacement à un autre.",
    Icon: ArrowLeftRight,
  },
  inventaire: {
    subtitle: "Comptage physique et ajustement des écarts.",
    Icon: ClipboardCheck,
  },
  historique: {
    subtitle: "Mouvements récents et pièces associées.",
    Icon: History,
  },
};

type LineQtyCost = { itemId: string; qty: string; unitCostCdf: string };
type LineQty = { itemId: string; qty: string };
type LineDelta = { itemId: string; qtyDelta: string };
type LineCount = { itemId: string; countedQty: string };

function parseUsdInputToCents(raw: string): number | null {
  const t = raw.replace(/\s/g, "").replace(",", ".").trim();
  if (t === "") return 0;
  const n = Number(t);
  if (!Number.isFinite(n) || n < 0) return null;
  const cents = Math.round(n * 100);
  if (cents > 999_999_999) return null;
  return cents;
}

function formatUsdCents(cents: number): string {
  return new Intl.NumberFormat("fr-FR", { style: "currency", currency: "USD" }).format(cents / 100);
}

function centsToUsdInputString(cents: number): string {
  const c = Number(cents);
  if (!Number.isFinite(c) || c <= 0) return "0";
  const v = c / 100;
  return v.toLocaleString("fr-FR", { minimumFractionDigits: 0, maximumFractionDigits: 2, useGrouping: false });
}

const ARTICLES_LIST_PAGE_SIZE = 10;

function stockAlertKindOrder(kind: string): number {
  if (kind === "stockout") return 0;
  if (kind === "overstock") return 1;
  return 2;
}

function stockAlertKindShortLabel(kind: string): string {
  if (kind === "stockout") return "Sous stock min";
  if (kind === "overstock") return "Sur-stock";
  if (kind === "reorder") return "Point de commande";
  return kind;
}

function stockAlertThresholdCell(a: StockDashboardAlert): string {
  if (a.kind === "stockout" && a.minQty != null) return `min ${a.minQty}`;
  if (a.kind === "overstock" && a.maxQty != null) return `plafond ${a.maxQty}`;
  if (a.kind === "reorder" && a.reorderPoint != null) return `point ${a.reorderPoint}`;
  return "—";
}

type StockAlertGroup = {
  itemId: string;
  itemCode: string;
  itemLabel: string;
  worstKind: string;
  lines: StockDashboardAlert[];
};

function groupStockAlertsByItem(alerts: StockDashboardAlert[]): StockAlertGroup[] {
  const map = new Map<string, StockDashboardAlert[]>();
  for (const a of alerts) {
    const list = map.get(a.itemId) ?? [];
    list.push(a);
    map.set(a.itemId, list);
  }
  const groups: StockAlertGroup[] = [];
  for (const [, lines] of map) {
    const sortedLines = [...lines].sort(
      (a, b) =>
        stockAlertKindOrder(a.kind) - stockAlertKindOrder(b.kind) ||
        a.locationLabel.localeCompare(b.locationLabel, "fr"),
    );
    let worstKind = sortedLines[0]?.kind ?? "reorder";
    for (const l of sortedLines) {
      if (stockAlertKindOrder(l.kind) < stockAlertKindOrder(worstKind)) worstKind = l.kind;
    }
    const first = sortedLines[0];
    if (!first) continue;
    groups.push({
      itemId: first.itemId,
      itemCode: first.itemCode,
      itemLabel: first.itemLabel,
      worstKind,
      lines: sortedLines,
    });
  }
  groups.sort(
    (a, b) =>
      stockAlertKindOrder(a.worstKind) - stockAlertKindOrder(b.worstKind) ||
      a.itemLabel.localeCompare(b.itemLabel, "fr"),
  );
  return groups;
}

export function Stocks() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const { section } = useParams<{ section: string }>();
  const allowedTabs = useMemo(() => [...getLogistiqueAllowedSections(user ?? null)], [user]);
  const tab = useMemo(() => tabFromSection(section, allowedTabs), [section, allowedTabs]);
  const { Icon: StocksHeaderIcon, subtitle: stocksHeaderSubtitle } = STOCKS_TAB_HEADER_META[tab];

  useEffect(() => {
    if (!user) return;
    if (section && !(allowedTabs as string[]).includes(section)) {
      navigate(defaultLogistiquePath(user), { replace: true });
    }
  }, [user, section, allowedTabs, navigate]);

  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [locations, setLocations] = useState<StockLocation[]>([]);
  const [items, setItems] = useState<StockItem[]>([]);
  const [balances, setBalances] = useState<StockBalanceRow[]>([]);
  const [suppliers, setSuppliers] = useState<StockSupplier[]>([]);
  const [documents, setDocuments] = useState<StockDocument[]>([]);
  const [eligibleReceiptPos, setEligibleReceiptPos] = useState<PurchaseOrderEligibleForReceipt[]>([]);
  const [stockAlerts, setStockAlerts] = useState<StockDashboardAlert[]>([]);
  const [toOrderLines, setToOrderLines] = useState<StockToOrderLine[]>([]);
  const [locFilter, setLocFilter] = useState("");
  const [articleRefs, setArticleRefs] = useState<InventoryArticleRefs | null>(null);

  const [itemLabel, setItemLabel] = useState("");
  const [itemUnit, setItemUnit] = useState("");
  const [itemCategory, setItemCategory] = useState("");
  const [itemSubcategory, setItemSubcategory] = useState("");
  /** Prix de vente en USD (saisie décimale, ex. 12,50) */
  const [itemSalePriceUsd, setItemSalePriceUsd] = useState("0");
  const [itemBusy, setItemBusy] = useState(false);

  const [editingItem, setEditingItem] = useState<StockItem | null>(null);
  const [editLabel, setEditLabel] = useState("");
  const [editUnit, setEditUnit] = useState("");
  const [editUnitQty, setEditUnitQty] = useState("1");
  const [editCategory, setEditCategory] = useState("");
  const [editSubcategory, setEditSubcategory] = useState("");
  const [editSalePriceUsd, setEditSalePriceUsd] = useState("0");
  const [editActive, setEditActive] = useState(true);
  const [editBusy, setEditBusy] = useState(false);

  const [supName, setSupName] = useState("");
  const [supPhone, setSupPhone] = useState("");
  const [supEmail, setSupEmail] = useState("");
  const [supAddress, setSupAddress] = useState("");
  const [supBusy, setSupBusy] = useState(false);

  const depotId = useMemo(() => locations.find((l) => l.kind === "depot")?.id ?? "", [locations]);

  const [recPoId, setRecPoId] = useState("");
  const [recRef, setRecRef] = useState("");
  const [recNote, setRecNote] = useState("");
  const [recLines, setRecLines] = useState<LineQtyCost[]>([{ itemId: "", qty: "1", unitCostCdf: "0" }]);
  const [recBusy, setRecBusy] = useState(false);

  const [trFrom, setTrFrom] = useState("");
  const [trTo, setTrTo] = useState("");
  const [trNote, setTrNote] = useState("");
  const [trLines, setTrLines] = useState<LineQty[]>([{ itemId: "", qty: "1" }]);
  const [trBusy, setTrBusy] = useState(false);

  const [adjLoc, setAdjLoc] = useState("");
  const [adjNote, setAdjNote] = useState("");
  const [adjLines, setAdjLines] = useState<LineDelta[]>([{ itemId: "", qtyDelta: "0" }]);
  const [adjBusy, setAdjBusy] = useState(false);

  const [invLoc, setInvLoc] = useState("");
  const [invNote, setInvNote] = useState("");
  const [invLines, setInvLines] = useState<LineCount[]>([{ itemId: "", countedQty: "0" }]);
  const [invBusy, setInvBusy] = useState(false);

  const [flash, setFlash] = useState<string | null>(null);
  const [articlesListPage, setArticlesListPage] = useState(1);
  const [articlesSearchQuery, setArticlesSearchQuery] = useState("");
  const [articlesFilterCategory, setArticlesFilterCategory] = useState("");
  const [articlesFilterSubcategory, setArticlesFilterSubcategory] = useState("");
  const [inventoryRefreshTick, setInventoryRefreshTick] = useState(0);
  const [seuilsSubTab, setSeuilsSubTab] = useState<SeuilsSubTab>("alertes");

  const refreshStockThresholdData = useCallback(async () => {
    const [al, ord] = await Promise.all([apiInventoryStockAlerts(), apiInventoryToOrder()]);
    setStockAlerts(al ?? []);
    setToOrderLines(ord?.lines ?? []);
  }, []);

  const stockAlertGroups = useMemo(() => groupStockAlertsByItem(stockAlerts), [stockAlerts]);

  const reload = useCallback(async () => {
    setLoading(true);
    setErr(null);
    const [loc, it, bal, sup, doc, eli, refs] = await Promise.all([
      apiInventoryLocations(),
      apiInventoryItems(true),
      apiInventoryBalances(),
      apiInventorySuppliers(),
      apiInventoryDocuments(50),
      apiListPurchaseOrdersEligibleForReceipt(),
      apiInventoryArticleRefs(),
    ]);
    setLoading(false);
    if (!loc || !it || bal === null || !sup || doc === null || eli === null) {
      setErr("Impossible de charger les données stocks (droits ou serveur).");
      return;
    }
    setLocations(loc);
    setItems(it);
    setArticleRefs(refs);
    setBalances(bal);
    setSuppliers(sup);
    setDocuments(doc);
    setEligibleReceiptPos(eli);
    setInventoryRefreshTick((t) => t + 1);
    void Promise.all([apiInventoryStockAlerts(), apiInventoryToOrder()]).then(([al, ord]) => {
      setStockAlerts(al ?? []);
      setToOrderLines(ord?.lines ?? []);
    });
    if (!trFrom && loc.length) {
      const d = loc.find((l) => l.kind === "depot");
      if (d) setTrFrom(d.id);
    }
    if (!trTo && loc.length) {
      const c = loc.find((l) => l.kind === "consumption");
      if (c) setTrTo(c.id);
    }
    if (!adjLoc && loc.length) setAdjLoc(loc[0]?.id ?? "");
    if (!invLoc && loc.length) setInvLoc(loc[0]?.id ?? "");
  }, [trFrom, trTo, adjLoc, invLoc]);

  useEffect(() => {
    void reload();
  }, []);

  useEffect(() => {
    if (!articleRefs?.categories?.length) return;
    setItemCategory((prev) =>
      prev && articleRefs.categories.some((c) => c.code === prev) ? prev : articleRefs.categories[0].code,
    );
  }, [articleRefs]);

  useEffect(() => {
    if (!articleRefs?.units?.length) return;
    setItemUnit((prev) =>
      prev && articleRefs.units.some((u) => u.code === prev) ? prev : articleRefs.units[0].code,
    );
  }, [articleRefs]);

  useEffect(() => {
    if (!itemCategory) return;
    const subs = articleRefs?.subcategories?.filter((s) => s.categoryCode === itemCategory) ?? [];
    setItemSubcategory((prev) => (prev && subs.some((s) => s.code === prev) ? prev : ""));
  }, [itemCategory, articleRefs]);

  useEffect(() => {
    if (!recPoId) {
      setRecLines([{ itemId: "", qty: "1", unitCostCdf: "0" }]);
      return;
    }
    const po = eligibleReceiptPos.find((p) => p.id === recPoId);
    if (!po?.lines.length) return;
    setRecLines(
      po.lines.map((ln) => ({
        itemId: ln.itemId,
        qty: String(ln.qtyRemaining),
        unitCostCdf: String(ln.unitCostCdfEst),
      })),
    );
  }, [recPoId, eligibleReceiptPos]);

  const filteredBalances = useMemo(() => {
    if (!locFilter.trim()) return balances;
    return balances.filter(
      (b) =>
        b.locationId === locFilter ||
        b.locationLabel.toLowerCase().includes(locFilter.toLowerCase()) ||
        b.locationCode.toLowerCase().includes(locFilter.toLowerCase()),
    );
  }, [balances, locFilter]);

  useEffect(() => {
    setArticlesFilterSubcategory("");
  }, [articlesFilterCategory]);

  useEffect(() => {
    setArticlesListPage(1);
  }, [articlesSearchQuery, articlesFilterCategory, articlesFilterSubcategory]);

  const sortedArticleCategories = useMemo(() => {
    return [...(articleRefs?.categories ?? [])].sort(
      (a, b) => a.sortOrder - b.sortOrder || a.code.localeCompare(b.code),
    );
  }, [articleRefs]);

  const sortedArticleUnits = useMemo(() => {
    return [...(articleRefs?.units ?? [])].sort(
      (a, b) => a.sortOrder - b.sortOrder || a.code.localeCompare(b.code),
    );
  }, [articleRefs]);

  const subcategoriesForArticlesListFilter = useMemo(() => {
    if (!articlesFilterCategory) return [];
    return (articleRefs?.subcategories ?? [])
      .filter((s) => s.categoryCode === articlesFilterCategory)
      .sort((a, b) => a.sortOrder - b.sortOrder || a.code.localeCompare(b.code));
  }, [articleRefs, articlesFilterCategory]);

  const filteredArticles = useMemo(() => {
    const q = articlesSearchQuery.trim().toLowerCase();
    return items.filter((it) => {
      if (articlesFilterCategory && it.category !== articlesFilterCategory) return false;
      if (articlesFilterSubcategory) {
        const sub = it.subcategory?.trim() ?? "";
        if (sub !== articlesFilterSubcategory) return false;
      }
      if (!q) return true;
      const hay = [
        it.code,
        it.label,
        it.category,
        it.categoryLabel ?? "",
        it.subcategory ?? "",
        it.subcategoryLabel ?? "",
        it.unit,
        it.unitLabel ?? "",
      ]
        .join(" ")
        .toLowerCase();
      return hay.includes(q);
    });
  }, [items, articlesSearchQuery, articlesFilterCategory, articlesFilterSubcategory]);

  const articlesListTotalPages = Math.max(1, Math.ceil(filteredArticles.length / ARTICLES_LIST_PAGE_SIZE));
  const pagedArticles = useMemo(() => {
    const start = (articlesListPage - 1) * ARTICLES_LIST_PAGE_SIZE;
    return filteredArticles.slice(start, start + ARTICLES_LIST_PAGE_SIZE);
  }, [filteredArticles, articlesListPage]);

  useEffect(() => {
    setArticlesListPage((p) => Math.min(Math.max(1, p), articlesListTotalPages));
  }, [articlesListTotalPages]);

  const articlesRangeFrom =
    filteredArticles.length === 0 ? 0 : (articlesListPage - 1) * ARTICLES_LIST_PAGE_SIZE + 1;
  const articlesRangeTo = Math.min(articlesListPage * ARTICLES_LIST_PAGE_SIZE, filteredArticles.length);

  const articlesListFiltersActive =
    articlesSearchQuery.trim() !== "" || !!articlesFilterCategory || !!articlesFilterSubcategory;

  const subcategoriesForSelectedCategory = useMemo(() => {
    return (articleRefs?.subcategories ?? [])
      .filter((s) => s.categoryCode === itemCategory)
      .sort((a, b) => a.sortOrder - b.sortOrder || a.code.localeCompare(b.code));
  }, [articleRefs, itemCategory]);

  const subcategoriesForEditCategory = useMemo(() => {
    return (articleRefs?.subcategories ?? [])
      .filter((s) => s.categoryCode === editCategory)
      .sort((a, b) => a.sortOrder - b.sortOrder || a.code.localeCompare(b.code));
  }, [articleRefs, editCategory]);

  const editSortedCategories = useMemo(() => {
    const base = sortedArticleCategories;
    if (!editCategory || base.some((c) => c.code === editCategory)) return base;
    return [...base, { code: editCategory, label: `${editCategory} (hors réf.)`, sortOrder: 9999 }];
  }, [sortedArticleCategories, editCategory]);

  const editSortedSubcategories = useMemo(() => {
    const base = subcategoriesForEditCategory;
    if (!editSubcategory || base.some((s) => s.code === editSubcategory)) return base;
    return [
      ...base,
      {
        code: editSubcategory,
        categoryCode: editCategory,
        label: `${editSubcategory} (hors réf.)`,
        sortOrder: 9999,
      },
    ];
  }, [subcategoriesForEditCategory, editCategory, editSubcategory]);

  const editSortedUnits = useMemo(() => {
    const base = sortedArticleUnits;
    if (!editUnit || base.some((u) => u.code === editUnit)) return base;
    return [...base, { code: editUnit, label: `${editUnit} (hors réf.)`, sortOrder: 9999 }];
  }, [sortedArticleUnits, editUnit]);

  useEffect(() => {
    if (!editingItem) return;
    setEditLabel(editingItem.label);
    setEditUnit(editingItem.unit);
    setEditUnitQty(String(editingItem.unitQty));
    setEditCategory(editingItem.category);
    setEditSubcategory(editingItem.subcategory?.trim() ?? "");
    setEditSalePriceUsd(centsToUsdInputString(editingItem.salePriceUsdCents ?? 0));
    setEditActive(editingItem.active);
  }, [editingItem]);

  useEffect(() => {
    if (!editingItem) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setEditingItem(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [editingItem]);

  const submitItem = async (e: React.FormEvent) => {
    e.preventDefault();
    const saleCents = parseUsdInputToCents(itemSalePriceUsd);
    if (saleCents === null) {
      setFlash("Prix de vente invalide (USD ≥ 0, ex. 12,50).");
      return;
    }
    setItemBusy(true);
    setFlash(null);
    const res = await apiInventoryCreateItem({
      label: itemLabel.trim(),
      unit: itemUnit.trim(),
      category: itemCategory || "general",
      salePriceUsdCents: saleCents,
      ...(itemSubcategory.trim() ? { subcategory: itemSubcategory.trim() } : {}),
    });
    setItemBusy(false);
    if (!res.ok) {
      setFlash(
        res.code === "code_generation_failed"
          ? "Impossible de générer un code article unique. Réessayez."
          : res.code === "duplicate_code"
            ? "Conflit de code article (rare). Réessayez."
            : res.code === "invalid_subcategory"
              ? "Sous-catégorie invalide pour cette catégorie (ou désactivée)."
              : res.code === "invalid_unit"
                ? "Unité invalide ou désactivée (Paramètres → Unités article)."
                : "Création impossible.",
      );
      return;
    }
    setItemLabel("");
    setItemSalePriceUsd("0");
    setFlash(`Article « ${res.item.label} » créé (code ${res.item.code}).`);
    await reload();
  };

  const submitEditItem = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingItem) return;
    const uq = Number(editUnitQty.replace(",", "."));
    if (!Number.isFinite(uq) || uq <= 0) {
      setFlash("Quantité par unité de conditionnement invalide (nombre > 0).");
      return;
    }
    const saleCents = parseUsdInputToCents(editSalePriceUsd);
    if (saleCents === null) {
      setFlash("Prix de vente invalide (USD ≥ 0, ex. 12,50).");
      return;
    }
    setEditBusy(true);
    setFlash(null);
    const res = await apiInventoryUpdateItem(editingItem.id, {
      label: editLabel.trim(),
      unit: editUnit.trim(),
      unitQty: uq,
      category: editCategory || "general",
      subcategory: editSubcategory.trim(),
      active: editActive,
      salePriceUsdCents: saleCents,
    });
    setEditBusy(false);
    if (!res.ok) {
      setFlash(
        res.code === "invalid_category"
          ? "Catégorie invalide ou désactivée."
          : res.code === "invalid_subcategory"
            ? "Sous-catégorie invalide pour cette catégorie (ou désactivée)."
            : res.code === "invalid_unit"
              ? "Unité invalide ou désactivée (référentiel Paramètres)."
              : "Enregistrement impossible.",
      );
      return;
    }
    setEditingItem(null);
    setFlash(`Article « ${res.item.label} » mis à jour.`);
    await reload();
  };

  const submitSupplier = async (e: React.FormEvent) => {
    e.preventDefault();
    setSupBusy(true);
    setFlash(null);
    const res = await apiInventoryCreateSupplier({
      name: supName.trim(),
      phone: supPhone.trim(),
      email: supEmail.trim(),
      address: supAddress.trim(),
    });
    setSupBusy(false);
    if (!res.ok) {
      setFlash("Fournisseur non enregistré.");
      return;
    }
    setSupName("");
    setSupPhone("");
    setSupEmail("");
    setSupAddress("");
    setFlash(`Fournisseur « ${res.supplier.name} » ajouté.`);
    await reload();
  };

  const parseReceiptLines = (): { itemId: string; qty: number; unitCostCdf: number }[] | null => {
    const out: { itemId: string; qty: number; unitCostCdf: number }[] = [];
    for (const ln of recLines) {
      if (!ln.itemId.trim()) continue;
      const qty = Number(ln.qty.replace(",", "."));
      const uc = Math.round(Number(ln.unitCostCdf.replace(/\s/g, "")));
      if (!Number.isFinite(qty) || qty <= 0) return null;
      if (!Number.isFinite(uc) || uc < 0) return null;
      out.push({ itemId: ln.itemId.trim(), qty, unitCostCdf: uc });
    }
    return out.length ? out : null;
  };

  const submitReceipt = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!depotId) {
      setFlash("Dépôt central introuvable.");
      return;
    }
    if (!recPoId.trim()) {
      setFlash("Sélectionnez un bon de commande approuvé à réceptionner.");
      return;
    }
    const lines = parseReceiptLines();
    if (!lines) {
      setFlash("Vérifiez les lignes (quantités > 0, coût CDF entier ≥ 0).");
      return;
    }
    setRecBusy(true);
    setFlash(null);
    const res = await apiInventoryReceipt({
      purchaseOrderId: recPoId.trim(),
      toLocationId: depotId,
      externalRef: recRef.trim(),
      note: recNote.trim(),
      lines,
    });
    setRecBusy(false);
    if (!res.ok) {
      setFlash(
        res.code === "invalid_depot"
          ? "Réception uniquement au dépôt."
          : res.code === "unknown_item"
            ? "Article inconnu ou inactif."
            : res.code === "qty_exceeds_po"
              ? "Quantité supérieure au reliquat du bon."
              : res.code === "item_not_on_po"
                ? "Article absent de ce bon."
                : res.code === "po_not_approved"
                  ? "Bon non approuvé pour réception."
                  : "Réception refusée.",
      );
      return;
    }
    setFlash(`Réception enregistrée (${res.documentId.slice(0, 8)}…).`);
    setRecLines([{ itemId: "", qty: "1", unitCostCdf: "0" }]);
    setRecRef("");
    setRecNote("");
    await reload();
  };

  const submitTransfer = async (e: React.FormEvent) => {
    e.preventDefault();
    const lines: { itemId: string; qty: number }[] = [];
    for (const ln of trLines) {
      if (!ln.itemId.trim()) continue;
      const qty = Number(ln.qty.replace(",", "."));
      if (!Number.isFinite(qty) || qty <= 0) {
        setFlash("Quantités transfert invalides.");
        return;
      }
      lines.push({ itemId: ln.itemId.trim(), qty });
    }
    if (!lines.length) {
      setFlash("Ajoutez au moins une ligne.");
      return;
    }
    setTrBusy(true);
    setFlash(null);
    const res = await apiInventoryTransfer({
      fromLocationId: trFrom,
      toLocationId: trTo,
      note: trNote.trim(),
      lines,
    });
    setTrBusy(false);
    if (!res.ok) {
      setFlash(
        res.code === "insufficient_stock"
          ? "Stock insuffisant au départ."
          : res.code === "same_location"
            ? "Origine et destination identiques."
            : "Transfert refusé.",
      );
      return;
    }
    setFlash("Transfert enregistré.");
    setTrLines([{ itemId: "", qty: "1" }]);
    setTrNote("");
    await reload();
  };

  const submitAdjustment = async (e: React.FormEvent) => {
    e.preventDefault();
    const lines: { itemId: string; qtyDelta: number }[] = [];
    for (const ln of adjLines) {
      if (!ln.itemId.trim()) continue;
      const qd = Number(ln.qtyDelta.replace(",", "."));
      if (!Number.isFinite(qd) || qd === 0) continue;
      lines.push({ itemId: ln.itemId.trim(), qtyDelta: qd });
    }
    if (!lines.length) {
      setFlash("Indiquez au moins une variation non nulle.");
      return;
    }
    setAdjBusy(true);
    setFlash(null);
    const res = await apiInventoryAdjustment({
      locationId: adjLoc,
      note: adjNote.trim(),
      lines,
    });
    setAdjBusy(false);
    if (!res.ok) {
      setFlash(res.code === "insufficient_stock" ? "Stock insuffisant pour cette sortie." : "Ajustement refusé.");
      return;
    }
    setFlash("Ajustement enregistré.");
    setAdjLines([{ itemId: "", qtyDelta: "0" }]);
    setAdjNote("");
    await reload();
  };

  const submitInventory = async (e: React.FormEvent) => {
    e.preventDefault();
    const lines: { itemId: string; countedQty: number }[] = [];
    for (const ln of invLines) {
      if (!ln.itemId.trim()) continue;
      const c = Number(ln.countedQty.replace(",", "."));
      if (!Number.isFinite(c) || c < 0) {
        setFlash("Quantités comptées invalides.");
        return;
      }
      lines.push({ itemId: ln.itemId.trim(), countedQty: c });
    }
    if (!lines.length) {
      setFlash("Ajoutez des lignes de comptage.");
      return;
    }
    setInvBusy(true);
    setFlash(null);
    const res = await apiInventoryCount({
      locationId: invLoc,
      note: invNote.trim(),
      lines,
    });
    setInvBusy(false);
    if (!res.ok) {
      setFlash(
        res.code === "no_variance"
          ? "Aucun écart : stock déjà aligné."
          : res.code === "insufficient_stock"
            ? "Écart impossible (stock négatif)."
            : "Inventaire refusé.",
      );
      return;
    }
    setFlash(`Inventaire enregistré : ${res.adjustments} ligne(s) ajustée(s).`);
    setInvLines([{ itemId: "", countedQty: "0" }]);
    setInvNote("");
    await reload();
  };

  return (
    <div>
      <Breadcrumb items={[{ label: "Stocks & achats" }]} />
      <header className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex h-12 w-12 items-center justify-center rounded-2xl border border-brand-orange/30 bg-brand-orange/10 text-brand-cream">
            <StocksHeaderIcon className="h-6 w-6" aria-hidden />
          </div>
          <div>
            <h1 className="font-display text-3xl tracking-wide text-white md:text-4xl">
              {logistiqueSectionLabel(tab)}
            </h1>
            <p className="mt-1 max-w-2xl text-sm text-white/45">{stocksHeaderSubtitle}</p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => void reload()}
          disabled={loading}
          className="inline-flex items-center gap-2 rounded-xl border border-white/15 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-white/70 hover:bg-white/5 disabled:opacity-40"
        >
          <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
          Actualiser
        </button>
      </header>

      <MessageDialog
        open={!!(err || flash)}
        message={err || flash || ""}
        variant={err ? "warning" : "success"}
        onClose={() => {
          setErr(null);
          setFlash(null);
        }}
      />

      {loading && !locations.length ? (
        <p className="text-white/45">Chargement…</p>
      ) : (
        <>
          {tab === "vue" ? (
            <div className="space-y-4">
              <div className="flex flex-wrap items-end gap-3">
                <div>
                  <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-white/40">
                    Filtrer par emplacement
                  </label>
                  <select
                    value={locFilter}
                    onChange={(e) => setLocFilter(e.target.value)}
                    className="rounded-xl border border-white/15 bg-black/30 px-3 py-2 text-sm text-white outline-none focus:ring-2 focus:ring-brand-orange/40"
                  >
                    <option value="">Tous</option>
                    {locations.map((l) => (
                      <option key={l.id} value={l.id}>
                        {l.label}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              <div className="overflow-hidden rounded-2xl border border-white/10 glass-panel">
                <table className="w-full text-left text-sm">
                  <thead className="border-b border-white/10 text-[10px] font-semibold uppercase tracking-wider text-white/40">
                    <tr>
                      <th className="px-4 py-3">Article</th>
                      <th className="px-4 py-3">Emplacement</th>
                      <th className="px-4 py-3 text-right">Qté</th>
                      <th className="px-4 py-3 text-right">CMP (CDF)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredBalances.length === 0 ? (
                      <tr>
                        <td colSpan={4} className="px-4 py-10 text-center text-white/40">
                          Aucun mouvement de stock pour l’instant. Enregistrez une réception au dépôt.
                        </td>
                      </tr>
                    ) : (
                      filteredBalances.map((b) => (
                        <tr key={`${b.itemId}-${b.locationId}`} className="border-b border-white/5">
                          <td className="px-4 py-2 text-white/80">
                            <span className="font-mono text-xs text-white/50">{b.itemCode}</span>{" "}
                            <span className="text-white/75">{b.itemLabel}</span>
                            <span className="text-white/35"> ({b.itemUnit})</span>
                          </td>
                          <td className="px-4 py-2 text-white/55">{b.locationLabel}</td>
                          <td className="px-4 py-2 text-right font-mono text-brand-cream/90">
                            {b.qty.toLocaleString("fr-FR", { maximumFractionDigits: 3 })}
                          </td>
                          <td className="px-4 py-2 text-right font-mono text-white/50">
                            {b.avgCostCdf.toLocaleString("fr-CD")}
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          ) : null}

          {tab === "articles" ? (
            <div className="grid gap-8 lg:grid-cols-[minmax(0,360px)_1fr]">
              <motion.form
                onSubmit={submitItem}
                className="rounded-2xl border border-white/10 glass-panel p-6"
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
              >
                <h2 className="font-display text-lg text-brand-cream/95">Nouvel article</h2>
                <p className="mt-1 text-[11px] text-white/35">
                  Le code article (SKU) est attribué automatiquement à la création (ex. CF-…).
                </p>
                <div className="mt-4 space-y-3">
                  <div>
                    <label className="mb-1 block text-[10px] font-semibold uppercase text-white/40">Libellé</label>
                    <input
                      value={itemLabel}
                      onChange={(e) => setItemLabel(e.target.value)}
                      className="w-full rounded-xl border border-white/15 bg-black/30 px-3 py-2 text-sm text-white outline-none focus:ring-2 focus:ring-brand-orange/40"
                      required
                    />
                  </div>
                  <div>
                    <label
                      htmlFor="new-item-unit"
                      className="mb-1 block text-[10px] font-semibold uppercase text-white/40"
                    >
                      Unité
                    </label>
                    <select
                      id="new-item-unit"
                      value={itemUnit}
                      onChange={(e) => setItemUnit(e.target.value)}
                      disabled={sortedArticleUnits.length === 0}
                      className="w-full rounded-xl border border-white/15 bg-black/30 px-3 py-2 text-sm text-white outline-none focus:ring-2 focus:ring-brand-orange/40 disabled:opacity-50"
                    >
                      {sortedArticleUnits.map((u) => (
                        <option key={u.code} value={u.code}>
                          {u.label}
                        </option>
                      ))}
                    </select>
                    {sortedArticleUnits.length === 0 ? (
                      <p className="mt-1 text-[11px] text-amber-200/80">
                        Aucune unité active. Définissez-les dans Paramètres → Unités article.
                      </p>
                    ) : null}
                  </div>
                  <div>
                    <label className="mb-1 block text-[10px] font-semibold uppercase text-white/40">Catégorie</label>
                    <select
                      value={itemCategory}
                      onChange={(e) => setItemCategory(e.target.value)}
                      disabled={sortedArticleCategories.length === 0}
                      className="w-full rounded-xl border border-white/15 bg-black/30 px-3 py-2 text-sm text-white outline-none focus:ring-2 focus:ring-brand-orange/40 disabled:opacity-50"
                    >
                      {sortedArticleCategories.map((c) => (
                        <option key={c.code} value={c.code}>
                          {c.label}
                        </option>
                      ))}
                    </select>
                    {sortedArticleCategories.length === 0 ? (
                      <p className="mt-1 text-[11px] text-amber-200/80">
                        Référentiel indisponible. Définissez les catégories dans Paramètres → Catégories article.
                      </p>
                    ) : null}
                  </div>
                  <div>
                    <label
                      htmlFor="new-item-subcategory"
                      className="mb-1 block text-[10px] font-semibold uppercase text-white/40"
                    >
                      Sous-catégorie
                    </label>
                    <SubcategoryCombobox
                      id="new-item-subcategory"
                      value={itemSubcategory}
                      onChange={setItemSubcategory}
                      options={subcategoriesForSelectedCategory.map((s) => ({ code: s.code, label: s.label }))}
                      disabled={!itemCategory || subcategoriesForSelectedCategory.length === 0}
                      categoryKey={itemCategory}
                    />
                    {itemCategory && subcategoriesForSelectedCategory.length === 0 ? (
                      <p className="mt-1 text-[11px] text-white/35">
                        Aucune sous-catégorie pour cette catégorie (Paramètres → Sous-catégories article).
                      </p>
                    ) : null}
                  </div>
                  <div>
                    <label
                      htmlFor="new-item-sale-price"
                      className="mb-1 block text-[10px] font-semibold uppercase text-white/40"
                    >
                      Prix de vente (USD)
                    </label>
                    <input
                      id="new-item-sale-price"
                      type="text"
                      inputMode="decimal"
                      value={itemSalePriceUsd}
                      onChange={(e) => setItemSalePriceUsd(e.target.value)}
                      placeholder="ex. 12,50"
                      className="w-full rounded-xl border border-white/15 bg-black/30 px-3 py-2 font-mono text-sm text-white outline-none focus:ring-2 focus:ring-brand-orange/40"
                    />
                    <p className="mt-1 text-[11px] text-white/35">
                      Montant public conseillé par unité de vente, en dollars (virgule ou point pour les centimes).
                    </p>
                  </div>
                  <button
                    type="submit"
                    disabled={
                      itemBusy || sortedArticleCategories.length === 0 || sortedArticleUnits.length === 0
                    }
                    className="w-full rounded-xl bg-gradient-to-r from-brand-red to-brand-red-orange py-2.5 text-sm font-semibold text-white disabled:opacity-40"
                  >
                    {itemBusy ? "…" : "Créer l’article"}
                  </button>
                </div>
              </motion.form>
              <div className="flex min-w-0 flex-col gap-3">
                <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end">
                  <div className="min-w-[200px] flex-1">
                    <label
                      htmlFor="articles-list-search"
                      className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-white/40"
                    >
                      Rechercher
                    </label>
                    <input
                      id="articles-list-search"
                      type="search"
                      value={articlesSearchQuery}
                      onChange={(e) => setArticlesSearchQuery(e.target.value)}
                      placeholder="Code, libellé, catégorie, sous-catégorie…"
                      disabled={loading || items.length === 0}
                      autoComplete="off"
                      className="w-full rounded-xl border border-white/15 bg-black/30 px-3 py-2 text-sm text-white outline-none placeholder:text-white/35 focus:ring-2 focus:ring-brand-orange/40 disabled:opacity-50"
                    />
                  </div>
                  <div className="min-w-[180px]">
                    <label
                      htmlFor="articles-list-cat"
                      className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-white/40"
                    >
                      Catégorie
                    </label>
                    <select
                      id="articles-list-cat"
                      value={articlesFilterCategory}
                      onChange={(e) => setArticlesFilterCategory(e.target.value)}
                      disabled={loading || sortedArticleCategories.length === 0}
                      className="w-full rounded-xl border border-white/15 bg-black/30 px-3 py-2 text-sm text-white outline-none focus:ring-2 focus:ring-brand-orange/40 disabled:opacity-50"
                    >
                      <option value="">Toutes</option>
                      {sortedArticleCategories.map((c) => (
                        <option key={c.code} value={c.code}>
                          {c.label}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="min-w-[200px]">
                    <label
                      htmlFor="articles-list-sub"
                      className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-white/40"
                    >
                      Sous-catégorie
                    </label>
                    <select
                      id="articles-list-sub"
                      value={articlesFilterSubcategory}
                      onChange={(e) => setArticlesFilterSubcategory(e.target.value)}
                      disabled={
                        loading ||
                        !articlesFilterCategory ||
                        subcategoriesForArticlesListFilter.length === 0
                      }
                      className="w-full rounded-xl border border-white/15 bg-black/30 px-3 py-2 text-sm text-white outline-none focus:ring-2 focus:ring-brand-orange/40 disabled:opacity-50"
                    >
                      <option value="">Toutes</option>
                      {subcategoriesForArticlesListFilter.map((s) => (
                        <option key={s.code} value={s.code}>
                          {s.label}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
                <div className="overflow-hidden rounded-2xl border border-white/10 glass-panel">
                {filteredArticles.length > ARTICLES_LIST_PAGE_SIZE ? (
                  <p className="border-b border-white/10 px-4 py-2 text-[11px] text-white/40">
                    <span className="tabular-nums text-white/55">{articlesRangeFrom}</span>–
                    <span className="tabular-nums text-white/55">{articlesRangeTo}</span> sur{" "}
                    <span className="tabular-nums text-white/55">{filteredArticles.length}</span> article
                    {filteredArticles.length !== 1 ? "s" : ""}
                    {articlesListFiltersActive ? (
                      <>
                        {" "}
                        (filtre · <span className="tabular-nums text-white/55">{items.length}</span> au total)
                      </>
                    ) : null}{" "}
                    · page{" "}
                    <span className="tabular-nums text-white/55">{articlesListPage}</span> /{" "}
                    <span className="tabular-nums text-white/55">{articlesListTotalPages}</span>
                  </p>
                ) : filteredArticles.length > 0 ? (
                  <p className="border-b border-white/10 px-4 py-2 text-[11px] text-white/40">
                    <span className="tabular-nums text-white/55">{filteredArticles.length}</span> article
                    {filteredArticles.length !== 1 ? "s" : ""}
                    {articlesListFiltersActive ? (
                      <>
                        {" "}
                        (sur <span className="tabular-nums text-white/55">{items.length}</span> au total)
                      </>
                    ) : null}
                  </p>
                ) : null}
                <table className="w-full text-left text-sm">
                  <thead className="border-b border-white/10 text-[10px] font-semibold uppercase tracking-wider text-white/40">
                    <tr>
                      <th className="px-4 py-3">Code</th>
                      <th className="px-4 py-3">Libellé</th>
                      <th className="px-4 py-3">Catégorie</th>
                      <th className="px-4 py-3">Sous-catégorie</th>
                      <th className="px-4 py-3 text-right">CMP</th>
                      <th className="px-4 py-3 text-right">Prix vente (USD)</th>
                      <th className="px-4 py-3 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {items.length === 0 ? (
                      <tr>
                        <td colSpan={7} className="px-4 py-10 text-center text-white/40">
                          Aucun article. Créez-en un avec le formulaire à gauche.
                        </td>
                      </tr>
                    ) : filteredArticles.length === 0 ? (
                      <tr>
                        <td colSpan={7} className="px-4 py-10 text-center text-white/40">
                          Aucun article ne correspond à la recherche ou aux filtres.
                        </td>
                      </tr>
                    ) : (
                      pagedArticles.map((it) => (
                        <tr key={it.id} className="border-b border-white/5">
                          <td className="px-4 py-2 font-mono text-xs text-white/55">{it.code}</td>
                          <td className="px-4 py-2 text-white/80">{it.label}</td>
                          <td className="px-4 py-2 text-white/45">{it.categoryLabel ?? it.category}</td>
                          <td className="px-4 py-2 text-white/45">
                            {it.subcategory?.trim() ? (it.subcategoryLabel ?? it.subcategory) : "—"}
                          </td>
                          <td className="px-4 py-2 text-right font-mono text-white/55">
                            {it.avgCostCdf.toLocaleString("fr-CD")} FC
                          </td>
                          <td className="px-4 py-2 text-right font-mono text-emerald-200/80">
                            {formatUsdCents(it.salePriceUsdCents ?? 0)}
                          </td>
                          <td className="px-4 py-2 text-right">
                            <button
                              type="button"
                              onClick={() => setEditingItem(it)}
                              className="inline-flex items-center justify-center rounded-lg border border-white/15 p-2 text-white/55 hover:bg-white/10 hover:text-white/90"
                              title="Modifier l’article"
                              aria-label={`Modifier ${it.code}`}
                            >
                              <Pencil className="h-4 w-4" aria-hidden />
                            </button>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
                {filteredArticles.length > ARTICLES_LIST_PAGE_SIZE ? (
                  <div className="flex flex-col gap-2 border-t border-white/10 bg-black/20 px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between">
                    <span className="text-[11px] text-white/35">
                      {ARTICLES_LIST_PAGE_SIZE} articles par page
                    </span>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        disabled={articlesListPage <= 1}
                        onClick={() => setArticlesListPage((p) => Math.max(1, p - 1))}
                        className="inline-flex items-center gap-1 rounded-lg border border-white/15 bg-black/30 px-3 py-1.5 text-xs font-medium text-white/85 outline-none hover:bg-white/[0.06] disabled:cursor-not-allowed disabled:opacity-40"
                      >
                        <ChevronLeft className="h-4 w-4" aria-hidden />
                        Précédent
                      </button>
                      <button
                        type="button"
                        disabled={articlesListPage >= articlesListTotalPages}
                        onClick={() =>
                          setArticlesListPage((p) => Math.min(articlesListTotalPages, p + 1))
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
              </div>
            </div>
          ) : null}

          {tab === "fournisseurs" ? (
            <div className="grid gap-8 lg:grid-cols-[minmax(0,360px)_1fr]">
              <form onSubmit={submitSupplier} className="rounded-2xl border border-white/10 glass-panel p-6">
                <h2 className="font-display text-lg text-brand-cream/95">Nouveau fournisseur</h2>
                <div className="mt-4 space-y-3">
                  <input
                    value={supName}
                    onChange={(e) => setSupName(e.target.value)}
                    placeholder="Raison sociale"
                    required
                    className="w-full rounded-xl border border-white/15 bg-black/30 px-3 py-2 text-sm text-white outline-none focus:ring-2 focus:ring-brand-orange/40"
                  />
                  <input
                    value={supPhone}
                    onChange={(e) => setSupPhone(e.target.value)}
                    placeholder="Téléphone"
                    className="w-full rounded-xl border border-white/15 bg-black/30 px-3 py-2 text-sm text-white outline-none focus:ring-2 focus:ring-brand-orange/40"
                  />
                  <input
                    value={supEmail}
                    onChange={(e) => setSupEmail(e.target.value)}
                    placeholder="E-mail"
                    className="w-full rounded-xl border border-white/15 bg-black/30 px-3 py-2 text-sm text-white outline-none focus:ring-2 focus:ring-brand-orange/40"
                  />
                  <label htmlFor="sup-address" className="sr-only">
                    Adresse physique
                  </label>
                  <textarea
                    id="sup-address"
                    value={supAddress}
                    onChange={(e) => setSupAddress(e.target.value)}
                    placeholder="Adresse physique (rue, quartier, ville…)"
                    rows={3}
                    className="w-full resize-y rounded-xl border border-white/15 bg-black/30 px-3 py-2 text-sm text-white outline-none focus:ring-2 focus:ring-brand-orange/40"
                  />
                  <button
                    type="submit"
                    disabled={supBusy}
                    className="w-full rounded-xl bg-gradient-to-r from-brand-red to-brand-red-orange py-2.5 text-sm font-semibold text-white disabled:opacity-40"
                  >
                    Enregistrer
                  </button>
                </div>
              </form>
              <div className="overflow-hidden rounded-2xl border border-white/10 glass-panel">
                <table className="w-full text-left text-sm">
                  <thead className="border-b border-white/10 text-[10px] font-semibold uppercase tracking-wider text-white/40">
                    <tr>
                      <th className="px-4 py-3">Nom</th>
                      <th className="px-4 py-3">Adresse</th>
                      <th className="px-4 py-3">Contact</th>
                    </tr>
                  </thead>
                  <tbody>
                    {suppliers.map((s) => (
                      <tr key={s.id} className="border-b border-white/5">
                        <td className="px-4 py-2 text-white/80">{s.name}</td>
                        <td className="max-w-[280px] px-4 py-2 text-white/50 whitespace-pre-wrap">
                          {s.address?.trim() ? s.address.trim() : "—"}
                        </td>
                        <td className="px-4 py-2 text-white/50">
                          {[s.phone, s.email].filter(Boolean).join(" · ") || "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ) : null}

          {tab === "seuils" ? (
            <div className="rounded-2xl border border-white/10 glass-panel p-6">
              <h2 className="font-display text-lg text-brand-cream/95">Seuils & réappro</h2>
              <p className="mt-1 text-xs text-white/40">
                {seuilsSubTab === "alertes"
                  ? "Stocks sous le minimum, au point de commande ou au-dessus du plafond — détail par article et par lieu."
                  : "Définissez les seuils par article et lieu (min, max, point de commande). Les alertes se mettent à jour après enregistrement."}
              </p>
              <div
                className="mt-4 flex w-full max-w-md gap-1 rounded-xl border border-white/10 bg-black/25 p-1"
                role="tablist"
                aria-label="Sous-sections seuils et réapprovisionnement"
              >
                <button
                  type="button"
                  role="tab"
                  aria-selected={seuilsSubTab === "alertes"}
                  id="seuils-subtab-alertes"
                  onClick={() => setSeuilsSubTab("alertes")}
                  className={`flex-1 rounded-lg px-3 py-2 text-center text-xs font-semibold uppercase tracking-wide transition-colors ${
                    seuilsSubTab === "alertes"
                      ? "bg-brand-orange/25 text-brand-cream shadow-sm"
                      : "text-white/45 hover:bg-white/5 hover:text-white/70"
                  }`}
                >
                  Alertes
                  {stockAlerts.length > 0 ? (
                    <span className="ml-1.5 rounded-md bg-brand-orange/30 px-1.5 py-0.5 text-[10px] font-bold tabular-nums text-brand-cream">
                      {stockAlerts.length}
                    </span>
                  ) : null}
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={seuilsSubTab === "seuils"}
                  id="seuils-subtab-seuils"
                  onClick={() => setSeuilsSubTab("seuils")}
                  className={`flex-1 rounded-lg px-3 py-2 text-center text-xs font-semibold uppercase tracking-wide transition-colors ${
                    seuilsSubTab === "seuils"
                      ? "bg-brand-orange/25 text-brand-cream shadow-sm"
                      : "text-white/45 hover:bg-white/5 hover:text-white/70"
                  }`}
                >
                  Seuils
                </button>
              </div>

              {seuilsSubTab === "alertes" ? (
                <div
                  className="mt-6"
                  role="tabpanel"
                  aria-labelledby="seuils-subtab-alertes"
                >
                  <h3 className="sr-only">Alertes actives</h3>
                  <p className="text-[11px] text-white/40">
                    Liste mise à jour après enregistrement des politiques ou actualisation de la page.
                  </p>
                  {stockAlerts.length === 0 ? (
                    <p className="mt-4 text-sm text-white/45">
                      Aucune alerte pour l’instant (stock dans les limites ou politiques non déclenchées).
                    </p>
                  ) : (
                    <div className="mt-4 space-y-3">
                      <p className="text-xs text-white/45">
                        {stockAlerts.length} alerte{stockAlerts.length > 1 ? "s" : ""} sur{" "}
                        {stockAlertGroups.length} article{stockAlertGroups.length > 1 ? "s" : ""} — chaque bloc est
                        repliable ; le tableau liste les lieux concernés.
                      </p>
                      <div className="max-h-[min(55vh,26rem)] space-y-2 overflow-y-auto pr-1">
                        {stockAlertGroups.map((g) => {
                          const borderClass =
                            g.worstKind === "stockout"
                              ? "border-brand-orange/30"
                              : g.worstKind === "overstock"
                                ? "border-amber-500/25"
                                : "border-white/10";
                          return (
                            <details
                              key={g.itemId}
                              className={`group rounded-xl border bg-black/25 ${borderClass} open:shadow-[inset_0_1px_0_0_rgba(255,255,255,0.04)]`}
                            >
                              <summary className="flex cursor-pointer list-none flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2.5 text-sm marker:content-none [&::-webkit-details-marker]:hidden">
                                <ChevronRight className="h-4 w-4 shrink-0 text-white/35 transition-transform group-open:rotate-90" />
                                <span
                                  className={`rounded-md px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${
                                    g.worstKind === "stockout"
                                      ? "bg-brand-orange/20 text-brand-orange"
                                      : g.worstKind === "overstock"
                                        ? "bg-amber-500/15 text-amber-200/90"
                                        : "bg-white/10 text-white/60"
                                  }`}
                                >
                                  {stockAlertKindShortLabel(g.worstKind)}
                                </span>
                                <span className="font-mono text-white/90">{g.itemCode}</span>
                                <span className="text-white/55">{g.itemLabel}</span>
                                <span className="ml-auto text-[11px] text-white/40">
                                  {g.lines.length} lieu{g.lines.length > 1 ? "x" : ""}
                                </span>
                              </summary>
                              <div className="border-t border-white/5 px-3 pb-3 pt-1">
                                <div className="overflow-x-auto rounded-lg border border-white/5">
                                  <table className="w-full min-w-[320px] text-left text-xs">
                                    <thead className="border-b border-white/10 text-[10px] font-semibold uppercase tracking-wider text-white/35">
                                      <tr>
                                        <th className="px-2 py-2">Type</th>
                                        <th className="px-2 py-2">Lieu</th>
                                        <th className="px-2 py-2 text-right">Stock</th>
                                        <th className="px-2 py-2">Seuil</th>
                                      </tr>
                                    </thead>
                                    <tbody>
                                      {g.lines.map((a) => (
                                        <tr key={`${a.itemId}-${a.locationId}-${a.kind}`} className="border-b border-white/[0.06] last:border-0">
                                          <td className="px-2 py-1.5 text-white/50">{stockAlertKindShortLabel(a.kind)}</td>
                                          <td className="px-2 py-1.5 text-white/75">{a.locationLabel}</td>
                                          <td className="px-2 py-1.5 text-right font-mono text-white/80">
                                            {a.qty.toLocaleString("fr-FR", { maximumFractionDigits: 3 })}
                                          </td>
                                          <td className="px-2 py-1.5 text-white/45">{stockAlertThresholdCell(a)}</td>
                                        </tr>
                                      ))}
                                    </tbody>
                                  </table>
                                </div>
                              </div>
                            </details>
                          );
                        })}
                      </div>
                      <p className="text-[11px] text-white/35">
                        Actions : onglet « À commander » pour les quantités suggérées, ou modifiez les règles dans
                        l’onglet « Seuils ».
                      </p>
                    </div>
                  )}
                </div>
              ) : (
                <div
                  className="mt-6"
                  role="tabpanel"
                  aria-labelledby="seuils-subtab-seuils"
                >
                  <h3 className="sr-only">Politiques de seuils</h3>
                  <StockReorderPoliciesPanel
                    items={items}
                    locations={locations}
                    balances={balances}
                    refreshSignal={inventoryRefreshTick}
                    onPoliciesSaved={refreshStockThresholdData}
                  />
                </div>
              )}
            </div>
          ) : null}

          {tab === "a-commander" ? (
            <div className="rounded-2xl border border-white/10 glass-panel p-6">
              <h2 className="font-display text-lg text-brand-cream/95">À commander</h2>
              <p className="mt-1 text-xs text-white/40">
                Suggestions basées sur les seuils : quantité suggérée pour réapprovisionner.
              </p>
              {toOrderLines.length === 0 ? (
                <p className="mt-4 text-sm text-white/45">Rien à commander selon les règles actuelles.</p>
              ) : (
                <div className="mt-4 overflow-x-auto">
                  <table className="w-full text-left text-sm">
                    <thead className="border-b border-white/10 text-[10px] font-semibold uppercase text-white/40">
                      <tr>
                        <th className="px-3 py-2">Article</th>
                        <th className="px-3 py-2">Lieu</th>
                        <th className="px-3 py-2 text-right">Stock</th>
                        <th className="px-3 py-2 text-right">Suggéré</th>
                      </tr>
                    </thead>
                    <tbody>
                      {toOrderLines.map((ln) => (
                        <tr key={`${ln.itemId}-${ln.locationId}`} className="border-b border-white/5">
                          <td className="px-3 py-2 text-white/80">
                            {ln.itemCode} — {ln.itemLabel}
                          </td>
                          <td className="px-3 py-2 text-white/55">{ln.locationLabel}</td>
                          <td className="px-3 py-2 text-right font-mono text-white/60">
                            {ln.qty.toLocaleString("fr-FR", { maximumFractionDigits: 3 })} {ln.itemUnit}
                          </td>
                          <td className="px-3 py-2 text-right font-mono text-emerald-200/90">
                            {ln.suggestedQty.toLocaleString("fr-FR", { maximumFractionDigits: 3 })}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          ) : null}

          {tab === "commandes" ? (
            <PurchaseOrdersPanel suppliers={suppliers} items={items} onDataChanged={() => void reload()} />
          ) : null}

          {tab === "reception" ? (
            <form onSubmit={submitReceipt} className="rounded-2xl border border-white/10 glass-panel p-6">
              <h2 className="font-display text-lg text-brand-cream/95">Réception au dépôt central</h2>
              <p className="mt-1 text-xs text-white/40">
                Réception liée à un <strong className="text-white/50">bon de commande approuvé</strong> : les quantités
                augmentent le dépôt ; le CMP article est recalculé (coût moyen pondéré).
              </p>
              <div className="mt-4 grid gap-4 sm:grid-cols-2">
                <div>
                  <label className="mb-1 block text-[10px] font-semibold uppercase text-white/40">Bon de commande</label>
                  <select
                    value={recPoId}
                    onChange={(e) => setRecPoId(e.target.value)}
                    className="w-full rounded-xl border border-white/15 bg-black/30 px-3 py-2 text-sm text-white outline-none focus:ring-2 focus:ring-brand-orange/40"
                  >
                    <option value="">— Choisir un bon —</option>
                    {eligibleReceiptPos.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.externalRef || p.id.slice(0, 8)} — {p.supplierName}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="mb-1 block text-[10px] font-semibold uppercase text-white/40">
                    Réf. facture / BL
                  </label>
                  <input
                    value={recRef}
                    onChange={(e) => setRecRef(e.target.value)}
                    className="w-full rounded-xl border border-white/15 bg-black/30 px-3 py-2 text-sm text-white outline-none focus:ring-2 focus:ring-brand-orange/40"
                  />
                </div>
              </div>
              <div className="mt-3">
                <label className="mb-1 block text-[10px] font-semibold uppercase text-white/40">Note</label>
                <textarea
                  value={recNote}
                  onChange={(e) => setRecNote(e.target.value)}
                  rows={2}
                  className="w-full resize-none rounded-xl border border-white/15 bg-black/30 px-3 py-2 text-sm text-white outline-none focus:ring-2 focus:ring-brand-orange/40"
                />
              </div>
              <div className="mt-4 space-y-2">
                {recLines.map((ln, i) => (
                  <div key={i} className="flex flex-wrap items-end gap-2">
                    <select
                      value={ln.itemId}
                      onChange={(e) => {
                        const next = [...recLines];
                        next[i] = { ...ln, itemId: e.target.value };
                        setRecLines(next);
                      }}
                      className="min-w-[200px] flex-1 rounded-xl border border-white/15 bg-black/30 px-3 py-2 text-sm text-white outline-none focus:ring-2 focus:ring-brand-orange/40"
                    >
                      <option value="">— Article —</option>
                      {items.map((it) => (
                        <option key={it.id} value={it.id}>
                          {it.code} — {it.label}
                        </option>
                      ))}
                    </select>
                    <input
                      type="text"
                      inputMode="decimal"
                      value={ln.qty}
                      onChange={(e) => {
                        const next = [...recLines];
                        next[i] = { ...ln, qty: e.target.value };
                        setRecLines(next);
                      }}
                      placeholder="Qté"
                      className="w-24 rounded-xl border border-white/15 bg-black/30 px-3 py-2 font-mono text-sm text-white outline-none focus:ring-2 focus:ring-brand-orange/40"
                    />
                    <input
                      type="text"
                      inputMode="numeric"
                      value={ln.unitCostCdf}
                      onChange={(e) => {
                        const next = [...recLines];
                        next[i] = { ...ln, unitCostCdf: e.target.value };
                        setRecLines(next);
                      }}
                      placeholder="Coût u. CDF"
                      className="w-32 rounded-xl border border-white/15 bg-black/30 px-3 py-2 font-mono text-sm text-white outline-none focus:ring-2 focus:ring-brand-orange/40"
                    />
                  </div>
                ))}
                <button
                  type="button"
                  onClick={() => setRecLines([...recLines, { itemId: "", qty: "1", unitCostCdf: "0" }])}
                  className="inline-flex items-center gap-1 rounded-lg border border-white/15 px-3 py-1.5 text-xs text-white/60 hover:bg-white/5"
                >
                  <Plus className="h-3.5 w-3.5" /> Ligne
                </button>
              </div>
              <button
                type="submit"
                disabled={recBusy || !depotId}
                className="mt-6 rounded-xl bg-gradient-to-r from-brand-red to-brand-red-orange px-6 py-2.5 text-sm font-semibold text-white disabled:opacity-40"
              >
                Valider la réception
              </button>
            </form>
          ) : null}

          {tab === "transfert" ? (
            <form onSubmit={submitTransfer} className="rounded-2xl border border-white/10 glass-panel p-6">
              <h2 className="font-display text-lg text-brand-cream/95">Transfert entre emplacements</h2>
              <p className="mt-1 text-xs text-white/40">Typiquement : dépôt → terrasse ou restaurant.</p>
              <div className="mt-4 grid gap-4 sm:grid-cols-2">
                <div>
                  <label className="mb-1 block text-[10px] font-semibold uppercase text-white/40">Origine</label>
                  <select
                    value={trFrom}
                    onChange={(e) => setTrFrom(e.target.value)}
                    className="w-full rounded-xl border border-white/15 bg-black/30 px-3 py-2 text-sm text-white outline-none focus:ring-2 focus:ring-brand-orange/40"
                  >
                    {locations.map((l) => (
                      <option key={l.id} value={l.id}>
                        {l.label}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="mb-1 block text-[10px] font-semibold uppercase text-white/40">Destination</label>
                  <select
                    value={trTo}
                    onChange={(e) => setTrTo(e.target.value)}
                    className="w-full rounded-xl border border-white/15 bg-black/30 px-3 py-2 text-sm text-white outline-none focus:ring-2 focus:ring-brand-orange/40"
                  >
                    {locations.map((l) => (
                      <option key={l.id} value={l.id}>
                        {l.label}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              <div className="mt-3">
                <label className="mb-1 block text-[10px] font-semibold uppercase text-white/40">Note</label>
                <textarea
                  value={trNote}
                  onChange={(e) => setTrNote(e.target.value)}
                  rows={2}
                  className="w-full resize-none rounded-xl border border-white/15 bg-black/30 px-3 py-2 text-sm text-white outline-none focus:ring-2 focus:ring-brand-orange/40"
                />
              </div>
              <div className="mt-4 space-y-2">
                {trLines.map((ln, i) => (
                  <div key={i} className="flex flex-wrap items-end gap-2">
                    <select
                      value={ln.itemId}
                      onChange={(e) => {
                        const next = [...trLines];
                        next[i] = { ...ln, itemId: e.target.value };
                        setTrLines(next);
                      }}
                      className="min-w-[220px] flex-1 rounded-xl border border-white/15 bg-black/30 px-3 py-2 text-sm text-white outline-none focus:ring-2 focus:ring-brand-orange/40"
                    >
                      <option value="">— Article —</option>
                      {items.map((it) => (
                        <option key={it.id} value={it.id}>
                          {it.code} — {it.label}
                        </option>
                      ))}
                    </select>
                    <input
                      type="text"
                      inputMode="decimal"
                      value={ln.qty}
                      onChange={(e) => {
                        const next = [...trLines];
                        next[i] = { ...ln, qty: e.target.value };
                        setTrLines(next);
                      }}
                      placeholder="Qté"
                      className="w-28 rounded-xl border border-white/15 bg-black/30 px-3 py-2 font-mono text-sm text-white outline-none focus:ring-2 focus:ring-brand-orange/40"
                    />
                  </div>
                ))}
                <button
                  type="button"
                  onClick={() => setTrLines([...trLines, { itemId: "", qty: "1" }])}
                  className="inline-flex items-center gap-1 rounded-lg border border-white/15 px-3 py-1.5 text-xs text-white/60 hover:bg-white/5"
                >
                  <Plus className="h-3.5 w-3.5" /> Ligne
                </button>
              </div>
              <button
                type="submit"
                disabled={trBusy}
                className="mt-6 rounded-xl bg-gradient-to-r from-brand-red to-brand-red-orange px-6 py-2.5 text-sm font-semibold text-white disabled:opacity-40"
              >
                Enregistrer le transfert
              </button>
            </form>
          ) : null}

          {tab === "inventaire" ? (
            <div className="grid gap-8 lg:grid-cols-2">
              <form onSubmit={submitAdjustment} className="rounded-2xl border border-white/10 glass-panel p-6">
                <h2 className="font-display text-lg text-brand-cream/95">Ajustement manuel</h2>
                <p className="mt-1 text-xs text-white/40">Variation positive ou négative (casse, erreur, etc.).</p>
                <div className="mt-4">
                  <label className="mb-1 block text-[10px] font-semibold uppercase text-white/40">Emplacement</label>
                  <select
                    value={adjLoc}
                    onChange={(e) => setAdjLoc(e.target.value)}
                    className="w-full rounded-xl border border-white/15 bg-black/30 px-3 py-2 text-sm text-white outline-none focus:ring-2 focus:ring-brand-orange/40"
                  >
                    {locations.map((l) => (
                      <option key={l.id} value={l.id}>
                        {l.label}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="mt-3">
                  <label className="mb-1 block text-[10px] font-semibold uppercase text-white/40">Note</label>
                  <textarea
                    value={adjNote}
                    onChange={(e) => setAdjNote(e.target.value)}
                    rows={2}
                    className="w-full resize-none rounded-xl border border-white/15 bg-black/30 px-3 py-2 text-sm text-white outline-none focus:ring-2 focus:ring-brand-orange/40"
                  />
                </div>
                <div className="mt-4 space-y-2">
                  {adjLines.map((ln, i) => (
                    <div key={i} className="flex flex-wrap gap-2">
                      <select
                        value={ln.itemId}
                        onChange={(e) => {
                          const next = [...adjLines];
                          next[i] = { ...ln, itemId: e.target.value };
                          setAdjLines(next);
                        }}
                        className="min-w-[200px] flex-1 rounded-xl border border-white/15 bg-black/30 px-3 py-2 text-sm text-white outline-none focus:ring-2 focus:ring-brand-orange/40"
                      >
                        <option value="">— Article —</option>
                        {items.map((it) => (
                          <option key={it.id} value={it.id}>
                            {it.code} — {it.label}
                          </option>
                        ))}
                      </select>
                      <input
                        type="text"
                        inputMode="decimal"
                        value={ln.qtyDelta}
                        onChange={(e) => {
                          const next = [...adjLines];
                          next[i] = { ...ln, qtyDelta: e.target.value };
                          setAdjLines(next);
                        }}
                        placeholder="Δ qté (+ / -)"
                        className="w-32 rounded-xl border border-white/15 bg-black/30 px-3 py-2 font-mono text-sm text-white outline-none focus:ring-2 focus:ring-brand-orange/40"
                      />
                    </div>
                  ))}
                  <button
                    type="button"
                    onClick={() => setAdjLines([...adjLines, { itemId: "", qtyDelta: "0" }])}
                    className="inline-flex items-center gap-1 rounded-lg border border-white/15 px-3 py-1.5 text-xs text-white/60 hover:bg-white/5"
                  >
                    <Plus className="h-3.5 w-3.5" /> Ligne
                  </button>
                </div>
                <button
                  type="submit"
                  disabled={adjBusy}
                  className="mt-6 rounded-xl border border-white/20 bg-white/5 px-6 py-2.5 text-sm font-semibold text-white hover:bg-white/10 disabled:opacity-40"
                >
                  Enregistrer l’ajustement
                </button>
              </form>

              <form onSubmit={submitInventory} className="rounded-2xl border border-white/10 glass-panel p-6">
                <h2 className="font-display text-lg text-brand-cream/95">Comptage d’inventaire</h2>
                <p className="mt-1 text-xs text-white/40">
                  Saisissez la quantité physiquement comptée ; l’écart est appliqué automatiquement.
                </p>
                <div className="mt-4">
                  <label className="mb-1 block text-[10px] font-semibold uppercase text-white/40">Emplacement</label>
                  <select
                    value={invLoc}
                    onChange={(e) => setInvLoc(e.target.value)}
                    className="w-full rounded-xl border border-white/15 bg-black/30 px-3 py-2 text-sm text-white outline-none focus:ring-2 focus:ring-brand-orange/40"
                  >
                    {locations.map((l) => (
                      <option key={l.id} value={l.id}>
                        {l.label}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="mt-3">
                  <label className="mb-1 block text-[10px] font-semibold uppercase text-white/40">Note</label>
                  <textarea
                    value={invNote}
                    onChange={(e) => setInvNote(e.target.value)}
                    rows={2}
                    className="w-full resize-none rounded-xl border border-white/15 bg-black/30 px-3 py-2 text-sm text-white outline-none focus:ring-2 focus:ring-brand-orange/40"
                  />
                </div>
                <div className="mt-4 space-y-2">
                  {invLines.map((ln, i) => (
                    <div key={i} className="flex flex-wrap gap-2">
                      <select
                        value={ln.itemId}
                        onChange={(e) => {
                          const next = [...invLines];
                          next[i] = { ...ln, itemId: e.target.value };
                          setInvLines(next);
                        }}
                        className="min-w-[200px] flex-1 rounded-xl border border-white/15 bg-black/30 px-3 py-2 text-sm text-white outline-none focus:ring-2 focus:ring-brand-orange/40"
                      >
                        <option value="">— Article —</option>
                        {items.map((it) => (
                          <option key={it.id} value={it.id}>
                            {it.code} — {it.label}
                          </option>
                        ))}
                      </select>
                      <input
                        type="text"
                        inputMode="decimal"
                        value={ln.countedQty}
                        onChange={(e) => {
                          const next = [...invLines];
                          next[i] = { ...ln, countedQty: e.target.value };
                          setInvLines(next);
                        }}
                        placeholder="Qté comptée"
                        className="w-32 rounded-xl border border-white/15 bg-black/30 px-3 py-2 font-mono text-sm text-white outline-none focus:ring-2 focus:ring-brand-orange/40"
                      />
                    </div>
                  ))}
                  <button
                    type="button"
                    onClick={() => setInvLines([...invLines, { itemId: "", countedQty: "0" }])}
                    className="inline-flex items-center gap-1 rounded-lg border border-white/15 px-3 py-1.5 text-xs text-white/60 hover:bg-white/5"
                  >
                    <Plus className="h-3.5 w-3.5" /> Ligne
                  </button>
                </div>
                <button
                  type="submit"
                  disabled={invBusy}
                  className="mt-6 rounded-xl bg-gradient-to-r from-brand-red to-brand-red-orange px-6 py-2.5 text-sm font-semibold text-white disabled:opacity-40"
                >
                  Valider l’inventaire
                </button>
              </form>
            </div>
          ) : null}

          {tab === "historique" ? (
            <div className="space-y-4">
              {documents.map((d) => (
                <div key={d.id} className="rounded-2xl border border-white/10 glass-panel p-4">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <p className="font-display text-sm text-brand-cream/90">
                      {DOC_LABELS[d.docType] ?? d.docType}{" "}
                      <span className="font-mono text-xs text-white/40">{d.id.slice(0, 8)}…</span>
                    </p>
                    <p className="text-[11px] text-white/40">
                      {d.createdAt.replace("T", " ").slice(0, 19)} · {d.createdByName ?? "—"}
                    </p>
                  </div>
                  {d.externalRef ? (
                    <p className="mt-1 text-xs text-white/50">Réf. {d.externalRef}</p>
                  ) : null}
                  {d.supplierName ? (
                    <p className="text-xs text-white/50">Fournisseur : {d.supplierName}</p>
                  ) : null}
                  {(d.fromLocationLabel || d.toLocationLabel) && d.docType === "transfer" ? (
                    <p className="text-xs text-white/55">
                      {d.fromLocationLabel} → {d.toLocationLabel}
                    </p>
                  ) : null}
                  {d.note ? <p className="mt-1 text-xs text-white/45">{d.note}</p> : null}
                  <ul className="mt-2 space-y-1 border-t border-white/5 pt-2 text-xs text-white/55">
                    {d.movements.map((m, i) => (
                      <li key={i}>
                        <span className="font-medium text-white/70">{m.itemLabel}</span> · {m.locationLabel} ·{" "}
                        <span className={m.qtyDelta >= 0 ? "text-emerald-300/90" : "text-rose-300/90"}>
                          {m.qtyDelta > 0 ? "+" : ""}
                          {m.qtyDelta.toLocaleString("fr-FR", { maximumFractionDigits: 3 })}
                        </span>{" "}
                        <span className="text-white/30">({m.ledgerKind})</span>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
              {documents.length === 0 ? (
                <p className="text-white/40">Aucun mouvement enregistré pour le moment.</p>
              ) : null}
            </div>
          ) : null}
        </>
      )}

      {editingItem ? (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center bg-black/65 p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="edit-stock-item-title"
          onClick={() => setEditingItem(null)}
        >
          <div
            className="max-h-[min(90vh,720px)] w-full max-w-lg overflow-y-auto rounded-2xl border border-white/15 bg-zinc-950/95 p-6 shadow-2xl backdrop-blur-md"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-4 flex items-start justify-between gap-3">
              <div>
                <h2 id="edit-stock-item-title" className="font-display text-lg text-brand-cream/95">
                  Modifier l’article
                </h2>
                <p className="mt-1 font-mono text-xs text-white/45">Code / SKU : {editingItem.code}</p>
              </div>
              <button
                type="button"
                onClick={() => setEditingItem(null)}
                className="rounded-lg border border-white/15 p-2 text-white/50 hover:bg-white/10 hover:text-white/90"
                aria-label="Fermer"
              >
                <X className="h-4 w-4" aria-hidden />
              </button>
            </div>
            <form onSubmit={submitEditItem} className="space-y-3">
              <div>
                <label htmlFor="edit-item-label" className="mb-1 block text-[10px] font-semibold uppercase text-white/40">
                  Libellé
                </label>
                <input
                  id="edit-item-label"
                  value={editLabel}
                  onChange={(e) => setEditLabel(e.target.value)}
                  required
                  className="w-full rounded-xl border border-white/15 bg-black/30 px-3 py-2 text-sm text-white outline-none focus:ring-2 focus:ring-brand-orange/40"
                />
              </div>
              <div>
                <label htmlFor="edit-item-unit" className="mb-1 block text-[10px] font-semibold uppercase text-white/40">
                  Unité
                </label>
                <select
                  id="edit-item-unit"
                  value={editUnit}
                  onChange={(e) => setEditUnit(e.target.value)}
                  disabled={editSortedUnits.length === 0}
                  className="w-full rounded-xl border border-white/15 bg-black/30 px-3 py-2 text-sm text-white outline-none focus:ring-2 focus:ring-brand-orange/40 disabled:opacity-50"
                >
                  {editSortedUnits.map((u) => (
                    <option key={u.code} value={u.code}>
                      {u.label}
                    </option>
                  ))}
                </select>
                {editSortedUnits.length === 0 ? (
                  <p className="mt-1 text-[11px] text-amber-200/80">
                    Référentiel unités indisponible. Paramètres → Unités article.
                  </p>
                ) : null}
              </div>
              <div>
                <label htmlFor="edit-item-unit-qty" className="mb-1 block text-[10px] font-semibold uppercase text-white/40">
                  Qté par unité de conditionnement
                </label>
                <input
                  id="edit-item-unit-qty"
                  type="text"
                  inputMode="decimal"
                  value={editUnitQty}
                  onChange={(e) => setEditUnitQty(e.target.value)}
                  className="w-full rounded-xl border border-white/15 bg-black/30 px-3 py-2 font-mono text-sm text-white outline-none focus:ring-2 focus:ring-brand-orange/40"
                />
              </div>
              <div>
                <label htmlFor="edit-item-category" className="mb-1 block text-[10px] font-semibold uppercase text-white/40">
                  Catégorie
                </label>
                <select
                  id="edit-item-category"
                  value={editCategory}
                  onChange={(e) => {
                    setEditCategory(e.target.value);
                    setEditSubcategory("");
                  }}
                  disabled={editSortedCategories.length === 0}
                  className="w-full rounded-xl border border-white/15 bg-black/30 px-3 py-2 text-sm text-white outline-none focus:ring-2 focus:ring-brand-orange/40 disabled:opacity-50"
                >
                  {editSortedCategories.map((c) => (
                    <option key={c.code} value={c.code}>
                      {c.label}
                    </option>
                  ))}
                </select>
                {editSortedCategories.length === 0 ? (
                  <p className="mt-1 text-[11px] text-amber-200/80">
                    Référentiel indisponible. Définissez les catégories dans Paramètres → Catégories article.
                  </p>
                ) : null}
              </div>
              <div>
                <label htmlFor="edit-item-subcategory" className="mb-1 block text-[10px] font-semibold uppercase text-white/40">
                  Sous-catégorie
                </label>
                <SubcategoryCombobox
                  id="edit-item-subcategory"
                  value={editSubcategory}
                  onChange={setEditSubcategory}
                  options={editSortedSubcategories.map((s) => ({ code: s.code, label: s.label }))}
                  disabled={!editCategory}
                  categoryKey={editCategory}
                />
                {editCategory && editSortedSubcategories.length === 0 ? (
                  <p className="mt-1 text-[11px] text-white/35">
                    Aucune sous-catégorie pour cette catégorie (Paramètres → Sous-catégories article).
                  </p>
                ) : null}
              </div>
              <div>
                <label htmlFor="edit-item-sale-price" className="mb-1 block text-[10px] font-semibold uppercase text-white/40">
                  Prix de vente (USD)
                </label>
                <input
                  id="edit-item-sale-price"
                  type="text"
                  inputMode="decimal"
                  value={editSalePriceUsd}
                  onChange={(e) => setEditSalePriceUsd(e.target.value)}
                  className="w-full rounded-xl border border-white/15 bg-black/30 px-3 py-2 font-mono text-sm text-white outline-none focus:ring-2 focus:ring-brand-orange/40"
                />
                <p className="mt-1 text-[11px] text-white/35">
                  Dollars par unité de vente (virgule ou point pour les centimes).
                </p>
              </div>
              <label className="flex cursor-pointer items-center gap-2 text-sm text-white/75">
                <input
                  type="checkbox"
                  checked={editActive}
                  onChange={(e) => setEditActive(e.target.checked)}
                  className="h-4 w-4 rounded border-white/25 bg-black/40 text-brand-orange focus:ring-brand-orange/40"
                />
                Article actif (visible dans les listes de mouvements)
              </label>
              <div className="flex flex-wrap gap-2 pt-2">
                <button
                  type="submit"
                  disabled={editBusy || editSortedCategories.length === 0 || editSortedUnits.length === 0}
                  className="flex-1 rounded-xl bg-gradient-to-r from-brand-red to-brand-red-orange py-2.5 text-sm font-semibold text-white disabled:opacity-40"
                >
                  {editBusy ? "…" : "Enregistrer"}
                </button>
                <button
                  type="button"
                  onClick={() => setEditingItem(null)}
                  className="rounded-xl border border-white/15 px-4 py-2.5 text-sm font-semibold text-white/70 hover:bg-white/5"
                >
                  Annuler
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}
    </div>
  );
}
