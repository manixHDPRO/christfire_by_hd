import { randomUUID } from "node:crypto";
import { db } from "./db.js";

/**
 * Articles vendus avec consommation de stock à l’emplacement du point de vente (transferts logistiques).
 * Cocktails, plats et autres lignes « catalogue seul » utilisent d’autres sous-catégories : pas de contrôle ici.
 */
export const COUNTER_SUBCATEGORIES_REQUIRING_POS_STOCK = new Set<string>(["boissons_service", "boissons_alcool_service"]);

export function counterSaleItemSubcategoryRequiresPosStock(subcategory: string | null | undefined): boolean {
  const s = (subcategory ?? "").trim();
  return s.length > 0 && COUNTER_SUBCATEGORIES_REQUIRING_POS_STOCK.has(s);
}

export function posStockLocationIdForPointOfSale(posId: string): string | null {
  const row = db
    .prepare(`SELECT stock_location_id FROM stock_points_of_sale WHERE id = ? AND active = 1`)
    .get(posId) as { stock_location_id: string } | undefined;
  return row?.stock_location_id ?? null;
}

export function stockMovementQtyAtLocation(itemId: string, locationId: string): number {
  const row = db
    .prepare(`SELECT COALESCE(SUM(qty_delta), 0) AS q FROM stock_movements WHERE item_id = ? AND location_id = ?`)
    .get(itemId, locationId) as { q: number } | undefined;
  return Number(row?.q ?? 0);
}

/** Si au moins une ligne existe pour ce PV, seuls ces articles sont autorisés à la vente sur ce point de vente. */
export function posCatalogRestrictsPointOfSale(pointOfSaleId: string): boolean {
  const row = db
    .prepare(`SELECT COUNT(*) AS c FROM stock_item_point_of_sale WHERE point_of_sale_id = ?`)
    .get(pointOfSaleId) as { c: number } | undefined;
  return Number(row?.c ?? 0) > 0;
}

export function itemIdAllowedOnPosCatalog(itemId: string, pointOfSaleId: string): boolean {
  if (!posCatalogRestrictsPointOfSale(pointOfSaleId)) return true;
  const ok = db
    .prepare(`SELECT 1 AS x FROM stock_item_point_of_sale WHERE point_of_sale_id = ? AND item_id = ?`)
    .get(pointOfSaleId, itemId) as { x?: number } | undefined;
  return !!ok;
}

/** @returns premier article non autorisé pour ce PV, ou null */
export function firstItemNotOnPosCatalog(mergedLines: MergedQtyLine[], pointOfSaleId: string): string | null {
  const seen = new Set<string>();
  for (const ln of mergedLines) {
    if (seen.has(ln.itemId)) continue;
    seen.add(ln.itemId);
    if (!itemIdAllowedOnPosCatalog(ln.itemId, pointOfSaleId)) return ln.itemId;
  }
  return null;
}

export type MergedQtyLine = { itemId: string; qty: number };

export type PosStockViolation = {
  itemId: string;
  requestedQty: number;
  availableQty: number;
};

/** Levée si le stock a changé entre la validation HTTP et l’écriture en base (concurrence). */
export class PosStockInsufficientError extends Error {
  readonly viol: PosStockViolation;
  constructor(viol: PosStockViolation) {
    super("insufficient_pos_stock");
    this.name = "PosStockInsufficientError";
    this.viol = viol;
  }
}

/**
 * Vérifie que chaque article « boisson stockée » a assez de quantité à l’emplacement du point de vente.
 * @returns null si OK, sinon détail de la première ligne en infraction.
 */
export function insufficientPosStockResponsePayload(viol: PosStockViolation): {
  code: "insufficient_pos_stock";
  itemId: string;
  itemLabel: string;
  requestedQty: number;
  availableQty: number;
} {
  const row = db.prepare(`SELECT label FROM stock_items WHERE id = ?`).get(viol.itemId) as { label?: string } | undefined;
  return {
    code: "insufficient_pos_stock",
    itemId: viol.itemId,
    itemLabel: row?.label?.trim() ?? "",
    requestedQty: viol.requestedQty,
    availableQty: viol.availableQty,
  };
}

export function validateMergedLinesAgainstPosStock(
  mergedLines: MergedQtyLine[],
  pointOfSaleId: string,
): PosStockViolation | null {
  if (mergedLines.length === 0) return null;
  const locationId = posStockLocationIdForPointOfSale(pointOfSaleId);
  const byItem = new Map<string, number>();
  for (const ln of mergedLines) {
    byItem.set(ln.itemId, (byItem.get(ln.itemId) ?? 0) + ln.qty);
  }
  const stmt = db.prepare(`SELECT id, subcategory FROM stock_items WHERE id = ? AND active = 1`);
  for (const [itemId, requestedQty] of byItem) {
    const r = stmt.get(itemId) as { id: string; subcategory: string } | undefined;
    if (!r) continue;
    if (!counterSaleItemSubcategoryRequiresPosStock(r.subcategory)) continue;
    const available = locationId ? stockMovementQtyAtLocation(itemId, locationId) : 0;
    if (requestedQty > available) {
      return { itemId, requestedQty, availableQty: available };
    }
  }
  return null;
}

/**
 * Après réservation temps réel du stock au fil des additions, le solde mouvements inclut déjà les quantités sur l’addition :
 * pour une mise à jour de lignes, on ne vérifie que le **delta** à retirer de l’emplacement.
 */
export function validatePosStockDeltaForTabLineUpdate(
  oldMerged: MergedQtyLine[],
  newMerged: MergedQtyLine[],
  pointOfSaleId: string,
): PosStockViolation | null {
  const locationId = posStockLocationIdForPointOfSale(pointOfSaleId);
  const oldM = qtyByItemId(oldMerged);
  const newM = qtyByItemId(newMerged);
  const itemIds = new Set<string>([...oldM.keys(), ...newM.keys()]);
  const stmt = db.prepare(`SELECT id, subcategory FROM stock_items WHERE id = ? AND active = 1`);
  for (const itemId of itemIds) {
    const prev = oldM.get(itemId) ?? 0;
    const next = newM.get(itemId) ?? 0;
    const delta = next - prev;
    if (delta <= 0) continue;
    const r = stmt.get(itemId) as { id: string; subcategory: string } | undefined;
    if (!r || !counterSaleItemSubcategoryRequiresPosStock(r.subcategory)) continue;
    const available = locationId ? stockMovementQtyAtLocation(itemId, locationId) : 0;
    if (delta > available) {
      return {
        itemId,
        requestedQty: delta,
        availableQty: available,
      };
    }
  }
  return null;
}

function qtyByItemId(lines: MergedQtyLine[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const ln of lines) {
    m.set(ln.itemId, (m.get(ln.itemId) ?? 0) + ln.qty);
  }
  return m;
}

/**
 * Applique delta (nouveau − ancien) sur les mouvements de stock à l’emplacement du PV.
 * `qty_delta` négatif = sortie physique (quantité ajoutée sur l’addition).
 */
export function applyFloorTabPosStockDeltaUnsafe(params: {
  tabId: string;
  pointOfSaleId: string;
  oldMerged: MergedQtyLine[];
  newMerged: MergedQtyLine[];
  createdByUserId: string | null;
}): void {
  const { tabId, pointOfSaleId, oldMerged, newMerged, createdByUserId } = params;

  const locationId = posStockLocationIdForPointOfSale(pointOfSaleId);
  if (!locationId) return;

  const oldM = qtyByItemId(oldMerged);
  const newM = qtyByItemId(newMerged);
  const itemIds = new Set<string>([...oldM.keys(), ...newM.keys()]);
  const itemStmt = db.prepare(
    `SELECT id, subcategory, avg_cost_cdf FROM stock_items WHERE id = ? AND active = 1`,
  );

  type Row = { itemId: string; delta: number; unitCostCdf: number };
  const rowsAdj: Row[] = [];
  for (const itemId of itemIds) {
    const prev = oldM.get(itemId) ?? 0;
    const next = newM.get(itemId) ?? 0;
    const delta = next - prev;
    if (delta === 0) continue;

    const r = itemStmt.get(itemId) as { id: string; subcategory: string; avg_cost_cdf: number } | undefined;
    if (!r || !counterSaleItemSubcategoryRequiresPosStock(r.subcategory)) continue;
    const unitCostCdf = Math.max(0, Math.round(Number(r.avg_cost_cdf ?? 0)));
    rowsAdj.push({ itemId, delta, unitCostCdf });
  }
  if (rowsAdj.length === 0) return;

  const docId = randomUUID();
  const extRef = `floor-tab:${tabId}`.slice(0, 200);
  const note = `Réserve addition service (${tabId.slice(0, 8)})`.slice(0, 2000);

  db.prepare(
    `INSERT INTO stock_documents (id, doc_type, supplier_id, from_location_id, to_location_id, external_ref, note, created_by_user_id)
     VALUES (@id, 'adjustment', NULL, @loc, @loc, @ext_ref, @note, @uid)`,
  ).run({
    id: docId,
    loc: locationId,
    ext_ref: extRef,
    note,
    uid: createdByUserId,
  });

  const insM = db.prepare(
    `INSERT INTO stock_movements (id, document_id, item_id, location_id, qty_delta, unit_cost_cdf, ledger_kind)
     VALUES (?, ?, ?, ?, ?, ?, 'adjustment')`,
  );

  for (const row of rowsAdj) {
    insM.run(randomUUID(), docId, row.itemId, locationId, -row.delta, row.unitCostCdf);
  }
}

/**
 * Décrémente le stock physique à l’emplacement lié au point de vente pour les articles sous contrôle stock.
 * À appeler **dans la même transaction** que l’insertion de `counter_sales` / `counter_sale_lines`.
 * Recheck le solde (concurrence) puis crée un document d’ajustement + mouvements négatifs.
 */
export function debitPosStockForCounterSaleUnsafe(params: {
  counterSaleId: string;
  pointOfSaleId: string;
  mergedLines: MergedQtyLine[];
  createdByUserId: string | null;
  invoiceRef?: string | null;
}): void {
  const { counterSaleId, pointOfSaleId, mergedLines, createdByUserId, invoiceRef } = params;
  if (mergedLines.length === 0) return;

  const viol = validateMergedLinesAgainstPosStock(mergedLines, pointOfSaleId);
  if (viol) throw new PosStockInsufficientError(viol);

  const locationId = posStockLocationIdForPointOfSale(pointOfSaleId);
  if (!locationId) return;

  const byItem = new Map<string, number>();
  for (const ln of mergedLines) {
    byItem.set(ln.itemId, (byItem.get(ln.itemId) ?? 0) + ln.qty);
  }

  const itemStmt = db.prepare(
    `SELECT subcategory, avg_cost_cdf FROM stock_items WHERE id = ? AND active = 1`,
  );
  const toDebit: { itemId: string; qty: number; unitCostCdf: number }[] = [];
  for (const [itemId, qty] of byItem) {
    if (qty <= 0) continue;
    const row = itemStmt.get(itemId) as { subcategory: string; avg_cost_cdf: number } | undefined;
    if (!row) continue;
    if (!counterSaleItemSubcategoryRequiresPosStock(row.subcategory)) continue;
    const unitCostCdf = Math.max(0, Math.round(Number(row.avg_cost_cdf ?? 0)));
    toDebit.push({ itemId, qty, unitCostCdf });
  }
  if (toDebit.length === 0) return;

  const docId = randomUUID();
  const refLabel = (invoiceRef?.trim() || counterSaleId).slice(0, 200);
  const note = `Sortie vente caisse — ${refLabel}`.slice(0, 2000);

  db.prepare(
    `INSERT INTO stock_documents (id, doc_type, supplier_id, from_location_id, to_location_id, external_ref, note, created_by_user_id)
     VALUES (@id, 'adjustment', NULL, @loc, @loc, @ext_ref, @note, @uid)`,
  ).run({
    id: docId,
    loc: locationId,
    ext_ref: counterSaleId.slice(0, 200),
    note,
    uid: createdByUserId,
  });

  const insM = db.prepare(
    `INSERT INTO stock_movements (id, document_id, item_id, location_id, qty_delta, unit_cost_cdf, ledger_kind)
     VALUES (?, ?, ?, ?, ?, ?, 'adjustment')`,
  );
  for (const d of toDebit) {
    insM.run(randomUUID(), docId, d.itemId, locationId, -d.qty, d.unitCostCdf);
  }
}
