import { randomUUID } from "node:crypto";
import type { Response, Router } from "express";
import { Router as createRouter } from "express";
import { z } from "zod";
import { recordAudit } from "../auditLog.js";
import { db } from "../db.js";
import { requireAuth, type AuthedRequest } from "../middleware/requireAuth.js";
import { requireAnyPermission } from "../middleware/requirePermission.js";
import { STOCK_REF_CODE_RE, normalizeStockRefCode } from "../stockRefCodes.js";

const putFxSchema = z.object({
  cdfPerUsd: z.coerce.number().int().min(1),
});

const categoryEnum = z.enum(["Premium", "Deluxe", "Standard"]);

const putRatesSchema = z.object({
  rates: z
    .array(
      z.object({
        category: categoryEnum,
        pricePerNightUSD: z.coerce.number().int().min(0),
      }),
    )
    .length(3)
    .refine((arr) => new Set(arr.map((r) => r.category)).size === 3, {
      message: "Les trois catégories (Premium, Deluxe, Standard) sont requises.",
    }),
});

const putVisitorEntrySchema = z
  .object({
    /** @deprecated utiliser adultPriceUsd ; si seul, copié sur adulte et mineur. */
    priceUsd: z.coerce.number().int().min(1).max(999_999).optional(),
    adultPriceUsd: z.coerce.number().int().min(1).max(999_999).optional(),
    minorPriceUsd: z.coerce.number().int().min(1).max(999_999).optional(),
  })
  .refine((d) => d.priceUsd !== undefined || d.adultPriceUsd !== undefined || d.minorPriceUsd !== undefined, {
    message: "Au moins un tarif est requis.",
  });

const putBungalowCategoriesSchema = z.object({
  categories: z
    .array(
      z.object({
        key: categoryEnum,
        label: z.string().trim().min(1).max(120),
      }),
    )
    .length(3)
    .refine((arr) => new Set(arr.map((c) => c.key)).size === 3, {
      message: "Les trois clés Premium, Deluxe, Standard sont requises.",
    }),
});

const putOccupancyRulesSchema = z.object({
  graceDays: z.coerce.number().int().min(1).max(5),
  penaltyUsd: z.coerce.number().int().min(0).max(999_999),
});

const stockArticleRefRowSchema = z.object({
  code: z
    .string()
    .min(1)
    .max(80)
    .transform((s) => normalizeStockRefCode(s))
    .refine((c) => STOCK_REF_CODE_RE.test(c), { message: "invalid_code" }),
  label: z.string().trim().min(1).max(120),
  sortOrder: z.coerce.number().int().min(0).max(99_999),
  active: z.boolean(),
});

const putStockArticleRefsSchema = z
  .object({
    categories: z.array(stockArticleRefRowSchema).min(1).max(200),
    units: z.array(stockArticleRefRowSchema).min(1).max(200),
  })
  .superRefine((data, ctx) => {
    if (new Set(data.categories.map((c) => c.code)).size !== data.categories.length) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "duplicate_category_code", path: ["categories"] });
    }
    if (new Set(data.units.map((u) => u.code)).size !== data.units.length) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "duplicate_unit_code", path: ["units"] });
    }
  });

const putStockItemCategoriesOnlySchema = z
  .object({
    categories: z.array(stockArticleRefRowSchema).min(1).max(200),
  })
  .superRefine((data, ctx) => {
    if (new Set(data.categories.map((c) => c.code)).size !== data.categories.length) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "duplicate_category_code", path: ["categories"] });
    }
  });

const putStockItemUnitsOnlySchema = z
  .object({
    units: z.array(stockArticleRefRowSchema).min(1).max(200),
  })
  .superRefine((data, ctx) => {
    if (new Set(data.units.map((u) => u.code)).size !== data.units.length) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "duplicate_unit_code", path: ["units"] });
    }
  });

const stockItemSubcategoryRowSchema = z.object({
  code: z
    .string()
    .min(1)
    .max(80)
    .transform((s) => normalizeStockRefCode(s))
    .refine((c) => STOCK_REF_CODE_RE.test(c), { message: "invalid_code" }),
  categoryCode: z
    .string()
    .min(1)
    .max(80)
    .transform((s) => normalizeStockRefCode(s))
    .refine((c) => STOCK_REF_CODE_RE.test(c), { message: "invalid_category_code" }),
  label: z.string().trim().min(1).max(120),
  sortOrder: z.coerce.number().int().min(0).max(99_999),
  active: z.boolean(),
});

const putStockItemSubcategoriesSchema = z
  .object({
    subcategories: z.array(stockItemSubcategoryRowSchema).max(500),
  })
  .superRefine((data, ctx) => {
    if (new Set(data.subcategories.map((s) => s.code)).size !== data.subcategories.length) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "duplicate_subcategory_code", path: ["subcategories"] });
    }
  });

function normalizeStockDepotCode(raw: string): string {
  return raw
    .trim()
    .toUpperCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/\s+/g, "_")
    .replace(/[^A-Z0-9_-]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 40);
}

const STOCK_DEPOT_CODE_RE = /^[A-Z0-9_-]{1,40}$/;

const postStockDepotSchema = z.object({
  label: z.string().trim().min(1).max(120),
});

const patchStockDepotSchema = z.object({
  label: z.string().trim().min(1).max(120).optional(),
  active: z.boolean().optional(),
});

function normalizeDiningTableCode(raw: string): string {
  return raw
    .trim()
    .toUpperCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/\s+/g, "-")
    .replace(/[^A-Z0-9_-]+/g, "")
    .replace(/^_+|_+$/g, "")
    .slice(0, 32);
}

const DINING_TABLE_CODE_RE = /^[A-Z0-9_-]{1,32}$/;

const postDiningTerraceTableSchema = z.object({
  pointOfSaleId: z.string().min(1).max(80),
  code: z.string().min(1).max(64),
  label: z.string().trim().min(1).max(120),
  seats: z.coerce.number().int().min(1).max(99).optional().default(4),
  sortOrder: z.coerce.number().int().min(0).max(9999).optional(),
});

const patchDiningTerraceTableSchema = z
  .object({
    code: z.string().min(1).max(64).optional(),
    label: z.string().trim().min(1).max(120).optional(),
    seats: z.coerce.number().int().min(1).max(99).optional(),
    sortOrder: z.coerce.number().int().min(0).max(9999).optional(),
    active: z.boolean().optional(),
  })
  .refine(
    (o) =>
      o.code !== undefined ||
      o.label !== undefined ||
      o.seats !== undefined ||
      o.sortOrder !== undefined ||
      o.active !== undefined,
    { message: "empty_patch" },
  );

type DiningTerraceTableRow = {
  id: string;
  point_of_sale_id: string;
  code: string;
  label: string;
  seats: number;
  sort_order: number;
  active: number;
};

function diningTableToPublic(row: DiningTerraceTableRow) {
  return {
    id: row.id,
    pointOfSaleId: row.point_of_sale_id,
    code: row.code,
    label: row.label,
    seats: row.seats,
    sortOrder: row.sort_order,
    active: row.active === 1,
  };
}

function diningTableCodeTaken(pointOfSaleId: string, code: string, excludeId?: string): boolean {
  const row = db
    .prepare(
      `SELECT id FROM dining_terrace_tables WHERE point_of_sale_id = ? AND code = ? COLLATE NOCASE`,
    )
    .get(pointOfSaleId, code) as { id: string } | undefined;
  if (!row) return false;
  if (excludeId && row.id === excludeId) return false;
  return true;
}

function allocateUniqueDepotCode(label: string): string {
  let base = normalizeStockDepotCode(label);
  if (!base || !STOCK_DEPOT_CODE_RE.test(base)) {
    base = "DEPOT";
  }
  base = base.slice(0, 36);
  const exists = db.prepare(`SELECT 1 FROM stock_locations WHERE code = ? COLLATE NOCASE`);
  for (let n = 0; n < 9999; n += 1) {
    const candidate = (n === 0 ? base : `${base}_${n + 1}`).slice(0, 40);
    if (!STOCK_DEPOT_CODE_RE.test(candidate)) continue;
    if (!exists.get(candidate)) return candidate;
  }
  const fallback = `DEPOT_${randomUUID().replace(/-/g, "").toUpperCase().slice(0, 12)}`;
  return fallback.slice(0, 40);
}

const ORDER = ["Premium", "Deluxe", "Standard"] as const;

export function settingsRoutes(): Router {
  const r = createRouter();

  r.get("/exchange-rate", requireAuth, (_req: AuthedRequest, res: Response) => {
    const row = db.prepare("SELECT cdf_per_usd FROM app_exchange_rate WHERE id = 1").get() as
      | { cdf_per_usd: number }
      | undefined;
    if (!row) {
      res.status(500).json({ error: "exchange_rate_not_configured" });
      return;
    }
    res.json({ cdfPerUsd: row.cdf_per_usd });
  });

  r.put("/exchange-rate", requireAuth, requireAnyPermission("settings.edit"), (req: AuthedRequest, res: Response) => {
    const parsed = putFxSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "validation_error" });
      return;
    }
    const info = db.prepare("UPDATE app_exchange_rate SET cdf_per_usd = ? WHERE id = 1").run(parsed.data.cdfPerUsd);
    if (info.changes === 0) {
      res.status(500).json({ error: "exchange_rate_not_configured" });
      return;
    }
    recordAudit({
      actorUserId: req.auth?.sub ?? null,
      action: "update",
      entityType: "settings",
      entityId: "exchange-rate",
      summary: `Taux CDF/USD : ${parsed.data.cdfPerUsd}`,
    });
    res.json({ cdfPerUsd: parsed.data.cdfPerUsd });
  });

  r.get("/category-rates", requireAuth, (_req: AuthedRequest, res: Response) => {
    const rows = db
      .prepare("SELECT category, price_per_night_usd AS pricePerNightUSD FROM category_rates")
      .all() as { category: string; pricePerNightUSD: number }[];
    const byCat = new Map(rows.map((x) => [x.category, x.pricePerNightUSD]));
    const rates = ORDER.map((category) => ({
      category,
      pricePerNightUSD: byCat.get(category) ?? 0,
    }));
    res.json({ rates });
  });

  r.put("/category-rates", requireAuth, requireAnyPermission("settings.edit"), (req: AuthedRequest, res: Response) => {
    const parsed = putRatesSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "validation_error" });
      return;
    }
    const upd = db.prepare(
      "INSERT INTO category_rates (category, price_per_night_usd) VALUES (@category, @price) ON CONFLICT(category) DO UPDATE SET price_per_night_usd = excluded.price_per_night_usd",
    );
    const run = db.transaction(() => {
      for (const row of parsed.data.rates) {
        upd.run({ category: row.category, price: row.pricePerNightUSD });
      }
    });
    run();
    const rows = db
      .prepare("SELECT category, price_per_night_usd AS pricePerNightUSD FROM category_rates")
      .all() as { category: string; pricePerNightUSD: number }[];
    const byCat = new Map(rows.map((x) => [x.category, x.pricePerNightUSD]));
    const rates = ORDER.map((category) => ({
      category,
      pricePerNightUSD: byCat.get(category) ?? 0,
    }));
    recordAudit({
      actorUserId: req.auth?.sub ?? null,
      action: "update",
      entityType: "settings",
      entityId: "category-rates",
      summary: "Grille tarifs nuitée / catégorie mise à jour",
    });
    res.json({ rates });
  });

  r.get("/visitor-entry-price", requireAuth, (_req: AuthedRequest, res: Response) => {
    const row = db
      .prepare("SELECT price_usd, adult_price_usd, minor_price_usd FROM app_visitor_entry WHERE id = 1")
      .get() as { price_usd: number; adult_price_usd?: number; minor_price_usd?: number } | undefined;
    if (!row) {
      res.status(500).json({ error: "visitor_entry_not_configured" });
      return;
    }
    const adult = Math.max(1, Math.floor(Number(row.adult_price_usd ?? row.price_usd ?? 10)));
    const minor = Math.max(1, Math.floor(Number(row.minor_price_usd ?? 5)));
    res.json({ priceUsd: adult, adultPriceUsd: adult, minorPriceUsd: minor });
  });

  r.put("/visitor-entry-price", requireAuth, requireAnyPermission("settings.edit"), (req: AuthedRequest, res: Response) => {
    const parsed = putVisitorEntrySchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "validation_error" });
      return;
    }
    const cur = db
      .prepare("SELECT price_usd, adult_price_usd, minor_price_usd FROM app_visitor_entry WHERE id = 1")
      .get() as { price_usd: number; adult_price_usd?: number; minor_price_usd?: number } | undefined;
    if (!cur) {
      res.status(500).json({ error: "visitor_entry_not_configured" });
      return;
    }
    const curAdult = Math.max(1, Math.floor(Number(cur.adult_price_usd ?? cur.price_usd ?? 10)));
    const curMinor = Math.max(1, Math.floor(Number(cur.minor_price_usd ?? 5)));
    let adult = parsed.data.adultPriceUsd ?? curAdult;
    let minor = parsed.data.minorPriceUsd ?? curMinor;
    if (parsed.data.priceUsd !== undefined && parsed.data.adultPriceUsd === undefined) {
      adult = parsed.data.priceUsd;
      if (parsed.data.minorPriceUsd === undefined) minor = parsed.data.priceUsd;
    }
    adult = Math.max(1, Math.floor(adult));
    minor = Math.max(1, Math.floor(minor));
    const info = db
      .prepare(
        "UPDATE app_visitor_entry SET price_usd = @p, adult_price_usd = @a, minor_price_usd = @m WHERE id = 1",
      )
      .run({ p: adult, a: adult, m: minor });
    if (info.changes === 0) {
      res.status(500).json({ error: "visitor_entry_not_configured" });
      return;
    }
    recordAudit({
      actorUserId: req.auth?.sub ?? null,
      action: "update",
      entityType: "settings",
      entityId: "visitor-entry-price",
      summary: `Tarifs droit d’entrée visiteur : adulte ${adult} USD, mineur ${minor} USD`,
    });
    res.json({ priceUsd: adult, adultPriceUsd: adult, minorPriceUsd: minor });
  });

  r.get("/bungalow-categories", requireAuth, (_req: AuthedRequest, res: Response) => {
    const rows = db.prepare("SELECT key, label FROM bungalow_categories").all() as { key: string; label: string }[];
    const byKey = new Map(rows.map((r) => [r.key, r.label]));
    const categories = ORDER.map((key) => ({
      key,
      label: byKey.get(key) ?? key,
    }));
    res.json({ categories });
  });

  r.put("/bungalow-categories", requireAuth, requireAnyPermission("settings.edit"), (req: AuthedRequest, res: Response) => {
    const parsed = putBungalowCategoriesSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "validation_error" });
      return;
    }
    const upsert = db.prepare(`
      INSERT INTO bungalow_categories (key, label) VALUES (@key, @label)
      ON CONFLICT(key) DO UPDATE SET label = excluded.label
    `);
    const run = db.transaction(() => {
      for (const row of parsed.data.categories) {
        upsert.run({ key: row.key, label: row.label });
      }
    });
    run();
    const rows = db.prepare("SELECT key, label FROM bungalow_categories").all() as { key: string; label: string }[];
    const byKey = new Map(rows.map((r) => [r.key, r.label]));
    const categories = ORDER.map((key) => ({
      key,
      label: byKey.get(key) ?? key,
    }));
    recordAudit({
      actorUserId: req.auth?.sub ?? null,
      action: "update",
      entityType: "settings",
      entityId: "bungalow-categories",
      summary: "Libellés catégories bungalow mis à jour",
    });
    res.json({ categories });
  });

  r.get("/occupancy-rules", requireAuth, (_req: AuthedRequest, res: Response) => {
    const row = db
      .prepare("SELECT grace_days, penalty_usd FROM app_occupancy_rules WHERE id = 1")
      .get() as { grace_days: number; penalty_usd: number } | undefined;
    if (!row) {
      res.status(500).json({ error: "occupancy_rules_not_configured" });
      return;
    }
    res.json({ graceDays: row.grace_days, penaltyUsd: row.penalty_usd });
  });

  r.put("/occupancy-rules", requireAuth, requireAnyPermission("settings.edit"), (req: AuthedRequest, res: Response) => {
    const parsed = putOccupancyRulesSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "validation_error" });
      return;
    }
    const info = db
      .prepare(
        "UPDATE app_occupancy_rules SET grace_days = @grace_days, penalty_usd = @penalty_usd WHERE id = 1",
      )
      .run({
        grace_days: parsed.data.graceDays,
        penalty_usd: parsed.data.penaltyUsd,
      });
    if (info.changes === 0) {
      res.status(500).json({ error: "occupancy_rules_not_configured" });
      return;
    }
    recordAudit({
      actorUserId: req.auth?.sub ?? null,
      action: "update",
      entityType: "settings",
      entityId: "occupancy-rules",
      summary: `Règles occupation : délai ${parsed.data.graceDays} j., pénalité ${parsed.data.penaltyUsd} USD`,
    });
    res.json({ graceDays: parsed.data.graceDays, penaltyUsd: parsed.data.penaltyUsd });
  });

  r.get("/stock-article-refs", requireAuth, requireAnyPermission("settings.edit"), (_req: AuthedRequest, res: Response) => {
    const categories = db
      .prepare(
        `SELECT code, label, sort_order AS sortOrder, active FROM stock_item_categories ORDER BY sort_order ASC, code ASC`,
      )
      .all() as { code: string; label: string; sortOrder: number; active: number }[];
    const units = db
      .prepare(
        `SELECT code, label, sort_order AS sortOrder, active FROM stock_item_units ORDER BY sort_order ASC, code ASC`,
      )
      .all() as { code: string; label: string; sortOrder: number; active: number }[];
    res.json({
      categories: categories.map((c) => ({
        code: c.code,
        label: c.label,
        sortOrder: c.sortOrder,
        active: c.active === 1,
      })),
      units: units.map((u) => ({
        code: u.code,
        label: u.label,
        sortOrder: u.sortOrder,
        active: u.active === 1,
      })),
    });
  });

  r.put("/stock-article-refs", requireAuth, requireAnyPermission("settings.edit"), (req: AuthedRequest, res: Response) => {
    const parsed = putStockArticleRefsSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "validation_error" });
      return;
    }
    const { categories, units } = parsed.data;
    if (!categories.some((c) => c.active)) {
      res.status(400).json({ error: "at_least_one_active_category" });
      return;
    }
    if (!units.some((u) => u.active)) {
      res.status(400).json({ error: "at_least_one_active_unit" });
      return;
    }

    const upsertCat = db.prepare(`
      INSERT INTO stock_item_categories (code, label, sort_order, active)
      VALUES (@code, @label, @sort_order, @active)
      ON CONFLICT(code) DO UPDATE SET
        label = excluded.label,
        sort_order = excluded.sort_order,
        active = excluded.active
    `);
    const upsertUnit = db.prepare(`
      INSERT INTO stock_item_units (code, label, sort_order, active)
      VALUES (@code, @label, @sort_order, @active)
      ON CONFLICT(code) DO UPDATE SET
        label = excluded.label,
        sort_order = excluded.sort_order,
        active = excluded.active
    `);
    const delCat = db.prepare(`DELETE FROM stock_item_categories WHERE code = ?`);
    const delUnit = db.prepare(`DELETE FROM stock_item_units WHERE code = ?`);
    const delSubByCategory = db.prepare(`DELETE FROM stock_item_subcategories WHERE category_code = ?`);

    try {
      const run = db.transaction(() => {
        const incomingCat = new Set(categories.map((c) => c.code));
        const existingCats = db.prepare(`SELECT code FROM stock_item_categories`).all() as { code: string }[];
        for (const { code } of existingCats) {
          if (incomingCat.has(code)) continue;
          const used = db.prepare(`SELECT 1 FROM stock_items WHERE category = ? LIMIT 1`).get(code);
          if (used) {
            throw new Error(`category_in_use:${code}`);
          }
          delSubByCategory.run(code);
          delCat.run(code);
        }
        for (const c of categories) {
          upsertCat.run({
            code: c.code,
            label: c.label,
            sort_order: c.sortOrder,
            active: c.active ? 1 : 0,
          });
        }

        const incomingUnit = new Set(units.map((u) => u.code));
        const existingUnits = db.prepare(`SELECT code FROM stock_item_units`).all() as { code: string }[];
        for (const { code } of existingUnits) {
          if (incomingUnit.has(code)) continue;
          const used = db.prepare(`SELECT 1 FROM stock_items WHERE unit = ? LIMIT 1`).get(code);
          if (used) {
            throw new Error(`unit_in_use:${code}`);
          }
          delUnit.run(code);
        }
        for (const u of units) {
          upsertUnit.run({
            code: u.code,
            label: u.label,
            sort_order: u.sortOrder,
            active: u.active ? 1 : 0,
          });
        }
      });
      run();
    } catch (e) {
      const msg = e instanceof Error ? e.message : "";
      if (msg.startsWith("category_in_use:")) {
        res.status(409).json({ error: "category_in_use", code: msg.slice("category_in_use:".length) });
        return;
      }
      if (msg.startsWith("unit_in_use:")) {
        res.status(409).json({ error: "unit_in_use", code: msg.slice("unit_in_use:".length) });
        return;
      }
      throw e;
    }

    recordAudit({
      actorUserId: req.auth?.sub ?? null,
      action: "update",
      entityType: "settings",
      entityId: "stock-article-refs",
      summary: "Référentiels stocks : catégories et unités article",
    });

    const categoriesOut = db
      .prepare(
        `SELECT code, label, sort_order AS sortOrder, active FROM stock_item_categories ORDER BY sort_order ASC, code ASC`,
      )
      .all() as { code: string; label: string; sortOrder: number; active: number }[];
    const unitsOut = db
      .prepare(
        `SELECT code, label, sort_order AS sortOrder, active FROM stock_item_units ORDER BY sort_order ASC, code ASC`,
      )
      .all() as { code: string; label: string; sortOrder: number; active: number }[];
    res.json({
      categories: categoriesOut.map((c) => ({
        code: c.code,
        label: c.label,
        sortOrder: c.sortOrder,
        active: c.active === 1,
      })),
      units: unitsOut.map((u) => ({
        code: u.code,
        label: u.label,
        sortOrder: u.sortOrder,
        active: u.active === 1,
      })),
    });
  });

  r.get("/stock-item-categories", requireAuth, requireAnyPermission("settings.edit"), (_req: AuthedRequest, res: Response) => {
    const rows = db
      .prepare(
        `SELECT code, label, sort_order AS sortOrder, active FROM stock_item_categories ORDER BY sort_order ASC, code ASC`,
      )
      .all() as { code: string; label: string; sortOrder: number; active: number }[];
    res.json({
      categories: rows.map((c) => ({
        code: c.code,
        label: c.label,
        sortOrder: c.sortOrder,
        active: c.active === 1,
      })),
    });
  });

  r.put("/stock-item-categories", requireAuth, requireAnyPermission("settings.edit"), (req: AuthedRequest, res: Response) => {
    const parsed = putStockItemCategoriesOnlySchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "validation_error" });
      return;
    }
    const { categories } = parsed.data;
    if (!categories.some((c) => c.active)) {
      res.status(400).json({ error: "at_least_one_active_category" });
      return;
    }

    const upsertCat = db.prepare(`
      INSERT INTO stock_item_categories (code, label, sort_order, active)
      VALUES (@code, @label, @sort_order, @active)
      ON CONFLICT(code) DO UPDATE SET
        label = excluded.label,
        sort_order = excluded.sort_order,
        active = excluded.active
    `);
    const delCat = db.prepare(`DELETE FROM stock_item_categories WHERE code = ?`);
    const delSubByCategory = db.prepare(`DELETE FROM stock_item_subcategories WHERE category_code = ?`);

    try {
      const run = db.transaction(() => {
        const incomingCat = new Set(categories.map((c) => c.code));
        const existingCats = db.prepare(`SELECT code FROM stock_item_categories`).all() as { code: string }[];
        for (const { code } of existingCats) {
          if (incomingCat.has(code)) continue;
          const used = db.prepare(`SELECT 1 FROM stock_items WHERE category = ? LIMIT 1`).get(code);
          if (used) {
            throw new Error(`category_in_use:${code}`);
          }
          delSubByCategory.run(code);
          delCat.run(code);
        }
        for (const c of categories) {
          upsertCat.run({
            code: c.code,
            label: c.label,
            sort_order: c.sortOrder,
            active: c.active ? 1 : 0,
          });
        }
      });
      run();
    } catch (e) {
      const msg = e instanceof Error ? e.message : "";
      if (msg.startsWith("category_in_use:")) {
        res.status(409).json({ error: "category_in_use", code: msg.slice("category_in_use:".length) });
        return;
      }
      throw e;
    }

    recordAudit({
      actorUserId: req.auth?.sub ?? null,
      action: "update",
      entityType: "settings",
      entityId: "stock-item-categories",
      summary: "Référentiel : catégories article (inventaire)",
    });

    const categoriesOut = db
      .prepare(
        `SELECT code, label, sort_order AS sortOrder, active FROM stock_item_categories ORDER BY sort_order ASC, code ASC`,
      )
      .all() as { code: string; label: string; sortOrder: number; active: number }[];
    res.json({
      categories: categoriesOut.map((c) => ({
        code: c.code,
        label: c.label,
        sortOrder: c.sortOrder,
        active: c.active === 1,
      })),
    });
  });

  r.get("/stock-item-units", requireAuth, requireAnyPermission("settings.edit"), (_req: AuthedRequest, res: Response) => {
    const rows = db
      .prepare(
        `SELECT code, label, sort_order AS sortOrder, active FROM stock_item_units ORDER BY sort_order ASC, code ASC`,
      )
      .all() as { code: string; label: string; sortOrder: number; active: number }[];
    res.json({
      units: rows.map((u) => ({
        code: u.code,
        label: u.label,
        sortOrder: u.sortOrder,
        active: u.active === 1,
      })),
    });
  });

  r.put("/stock-item-units", requireAuth, requireAnyPermission("settings.edit"), (req: AuthedRequest, res: Response) => {
    const parsed = putStockItemUnitsOnlySchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "validation_error" });
      return;
    }
    const { units } = parsed.data;
    if (!units.some((u) => u.active)) {
      res.status(400).json({ error: "at_least_one_active_unit" });
      return;
    }

    const upsertUnit = db.prepare(`
      INSERT INTO stock_item_units (code, label, sort_order, active)
      VALUES (@code, @label, @sort_order, @active)
      ON CONFLICT(code) DO UPDATE SET
        label = excluded.label,
        sort_order = excluded.sort_order,
        active = excluded.active
    `);
    const delUnit = db.prepare(`DELETE FROM stock_item_units WHERE code = ?`);

    try {
      const run = db.transaction(() => {
        const incomingUnit = new Set(units.map((u) => u.code));
        const existingUnits = db.prepare(`SELECT code FROM stock_item_units`).all() as { code: string }[];
        for (const { code } of existingUnits) {
          if (incomingUnit.has(code)) continue;
          const used = db.prepare(`SELECT 1 FROM stock_items WHERE unit = ? LIMIT 1`).get(code);
          if (used) {
            throw new Error(`unit_in_use:${code}`);
          }
          delUnit.run(code);
        }
        for (const u of units) {
          upsertUnit.run({
            code: u.code,
            label: u.label,
            sort_order: u.sortOrder,
            active: u.active ? 1 : 0,
          });
        }
      });
      run();
    } catch (e) {
      const msg = e instanceof Error ? e.message : "";
      if (msg.startsWith("unit_in_use:")) {
        res.status(409).json({ error: "unit_in_use", code: msg.slice("unit_in_use:".length) });
        return;
      }
      throw e;
    }

    recordAudit({
      actorUserId: req.auth?.sub ?? null,
      action: "update",
      entityType: "settings",
      entityId: "stock-item-units",
      summary: "Référentiel : unités article (inventaire)",
    });

    const unitsOut = db
      .prepare(
        `SELECT code, label, sort_order AS sortOrder, active FROM stock_item_units ORDER BY sort_order ASC, code ASC`,
      )
      .all() as { code: string; label: string; sortOrder: number; active: number }[];
    res.json({
      units: unitsOut.map((u) => ({
        code: u.code,
        label: u.label,
        sortOrder: u.sortOrder,
        active: u.active === 1,
      })),
    });
  });

  r.get("/stock-item-subcategories", requireAuth, requireAnyPermission("settings.edit"), (_req: AuthedRequest, res: Response) => {
    const rows = db
      .prepare(
        `SELECT s.code, s.category_code AS categoryCode, c.label AS categoryLabel, s.label, s.sort_order AS sortOrder, s.active
         FROM stock_item_subcategories s
         JOIN stock_item_categories c ON c.code = s.category_code
         ORDER BY c.sort_order ASC, s.sort_order ASC, s.code ASC`,
      )
      .all() as {
      code: string;
      categoryCode: string;
      categoryLabel: string;
      label: string;
      sortOrder: number;
      active: number;
    }[];
    res.json({
      subcategories: rows.map((r) => ({
        code: r.code,
        categoryCode: r.categoryCode,
        categoryLabel: r.categoryLabel,
        label: r.label,
        sortOrder: r.sortOrder,
        active: r.active === 1,
      })),
    });
  });

  r.put("/stock-item-subcategories", requireAuth, requireAnyPermission("settings.edit"), (req: AuthedRequest, res: Response) => {
    const parsed = putStockItemSubcategoriesSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "validation_error" });
      return;
    }
    const { subcategories } = parsed.data;
    if (subcategories.length > 0 && !subcategories.some((s) => s.active)) {
      res.status(400).json({ error: "at_least_one_active_subcategory" });
      return;
    }

    const validCats = new Set(
      (db.prepare(`SELECT code FROM stock_item_categories`).all() as { code: string }[]).map((x) => x.code),
    );
    for (const s of subcategories) {
      if (!validCats.has(s.categoryCode)) {
        res.status(400).json({ error: "unknown_category", code: s.categoryCode });
        return;
      }
    }

    const upsertSub = db.prepare(`
      INSERT INTO stock_item_subcategories (code, category_code, label, sort_order, active)
      VALUES (@code, @category_code, @label, @sort_order, @active)
      ON CONFLICT(code) DO UPDATE SET
        category_code = excluded.category_code,
        label = excluded.label,
        sort_order = excluded.sort_order,
        active = excluded.active
    `);
    const delSub = db.prepare(`DELETE FROM stock_item_subcategories WHERE code = ?`);

    try {
      const run = db.transaction(() => {
        const incoming = new Set(subcategories.map((s) => s.code));
        const existing = db.prepare(`SELECT code FROM stock_item_subcategories`).all() as { code: string }[];
        for (const { code } of existing) {
          if (incoming.has(code)) continue;
          const used = db.prepare(`SELECT 1 FROM stock_items WHERE subcategory = ? LIMIT 1`).get(code);
          if (used) {
            throw new Error(`subcategory_in_use:${code}`);
          }
          delSub.run(code);
        }
        for (const s of subcategories) {
          upsertSub.run({
            code: s.code,
            category_code: s.categoryCode,
            label: s.label,
            sort_order: s.sortOrder,
            active: s.active ? 1 : 0,
          });
        }
      });
      run();
    } catch (e) {
      const msg = e instanceof Error ? e.message : "";
      if (msg.startsWith("subcategory_in_use:")) {
        res.status(409).json({ error: "subcategory_in_use", code: msg.slice("subcategory_in_use:".length) });
        return;
      }
      throw e;
    }

    recordAudit({
      actorUserId: req.auth?.sub ?? null,
      action: "update",
      entityType: "settings",
      entityId: "stock-item-subcategories",
      summary: "Référentiel : sous-catégories article (inventaire)",
    });

    const rows = db
      .prepare(
        `SELECT s.code, s.category_code AS categoryCode, c.label AS categoryLabel, s.label, s.sort_order AS sortOrder, s.active
         FROM stock_item_subcategories s
         JOIN stock_item_categories c ON c.code = s.category_code
         ORDER BY c.sort_order ASC, s.sort_order ASC, s.code ASC`,
      )
      .all() as {
      code: string;
      categoryCode: string;
      categoryLabel: string;
      label: string;
      sortOrder: number;
      active: number;
    }[];
    res.json({
      subcategories: rows.map((r) => ({
        code: r.code,
        categoryCode: r.categoryCode,
        categoryLabel: r.categoryLabel,
        label: r.label,
        sortOrder: r.sortOrder,
        active: r.active === 1,
      })),
    });
  });

  r.get("/stock-depots", requireAuth, requireAnyPermission("settings.edit"), (_req: AuthedRequest, res: Response) => {
    const rows = db
      .prepare(
        `SELECT id, code, label, sort_order AS sortOrder, active
         FROM stock_locations
         WHERE kind = 'depot'
         ORDER BY sort_order ASC, code COLLATE NOCASE ASC`,
      )
      .all() as { id: string; code: string; label: string; sortOrder: number; active: number }[];
    res.json({
      depots: rows.map((r) => ({
        id: r.id,
        code: r.code,
        label: r.label,
        sortOrder: r.sortOrder,
        active: r.active === 1,
      })),
    });
  });

  r.post("/stock-depots", requireAuth, requireAnyPermission("settings.edit"), (req: AuthedRequest, res: Response) => {
    const parsed = postStockDepotSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ code: "validation_error" });
      return;
    }
    const labelTrim = parsed.data.label.trim();
    const codeNorm = allocateUniqueDepotCode(labelTrim);
    const maxSort =
      (db.prepare(`SELECT COALESCE(MAX(sort_order), -1) AS m FROM stock_locations`).get() as { m: number }).m ?? -1;
    const sortOrder = maxSort + 1;
    const id = randomUUID();
    db.prepare(
      `INSERT INTO stock_locations (id, code, label, kind, sort_order, active)
       VALUES (?, ?, ?, 'depot', ?, 1)`,
    ).run(id, codeNorm, labelTrim, sortOrder);

    recordAudit({
      actorUserId: req.auth?.sub ?? null,
      action: "create",
      entityType: "settings",
      entityId: "stock-depot",
      summary: `Dépôt stock créé : ${codeNorm} (${labelTrim})`,
    });

    const row = db
      .prepare(`SELECT id, code, label, sort_order AS sortOrder, active FROM stock_locations WHERE id = ?`)
      .get(id) as { id: string; code: string; label: string; sortOrder: number; active: number };
    res.status(201).json({
      depot: {
        id: row.id,
        code: row.code,
        label: row.label,
        sortOrder: row.sortOrder,
        active: row.active === 1,
      },
    });
  });

  r.patch("/stock-depots/:id", requireAuth, requireAnyPermission("settings.edit"), (req: AuthedRequest, res: Response) => {
    const id = typeof req.params.id === "string" ? req.params.id.trim() : "";
    if (!id) {
      res.status(400).json({ code: "validation_error" });
      return;
    }
    const parsed = patchStockDepotSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ code: "validation_error" });
      return;
    }
    if (parsed.data.label === undefined && parsed.data.active === undefined) {
      res.status(400).json({ code: "validation_error" });
      return;
    }
    const existing = db
      .prepare(`SELECT id, code, label, sort_order AS sortOrder, active FROM stock_locations WHERE id = ? AND kind = 'depot'`)
      .get(id) as { id: string; code: string; label: string; sortOrder: number; active: number } | undefined;
    if (!existing) {
      res.status(404).json({ code: "not_found" });
      return;
    }

    const nextLabel = parsed.data.label !== undefined ? parsed.data.label.trim() : existing.label;
    let nextActive = parsed.data.active !== undefined ? (parsed.data.active ? 1 : 0) : existing.active;

    if (existing.active === 1 && nextActive === 0) {
      const otherActive = (
        db
          .prepare(
            `SELECT COUNT(*) AS c FROM stock_locations WHERE kind = 'depot' AND active = 1 AND id != ?`,
          )
          .get(id) as { c: number }
      ).c;
      if (otherActive === 0) {
        res.status(400).json({ code: "last_depot_active" });
        return;
      }
    }

    db.prepare(`UPDATE stock_locations SET label = ?, active = ? WHERE id = ? AND kind = 'depot'`).run(
      nextLabel,
      nextActive,
      id,
    );

    recordAudit({
      actorUserId: req.auth?.sub ?? null,
      action: "update",
      entityType: "settings",
      entityId: "stock-depot",
      summary: `Dépôt stock mis à jour : ${existing.code}`,
    });

    const row = db
      .prepare(`SELECT id, code, label, sort_order AS sortOrder, active FROM stock_locations WHERE id = ?`)
      .get(id) as { id: string; code: string; label: string; sortOrder: number; active: number };
    res.json({
      depot: {
        id: row.id,
        code: row.code,
        label: row.label,
        sortOrder: row.sortOrder,
        active: row.active === 1,
      },
    });
  });

  r.get(
    "/terrace-points-of-sale",
    requireAuth,
    requireAnyPermission("settings.edit"),
    (_req: AuthedRequest, res: Response) => {
      const rows = db
        .prepare(
          `SELECT id, code, label, sort_order AS sortOrder, active
           FROM stock_points_of_sale
           ORDER BY active DESC, is_main DESC, sort_order ASC, code COLLATE NOCASE ASC`,
        )
        .all() as { id: string; code: string; label: string; sortOrder: number; active: number }[];
      res.json({
        terraces: rows.map((p) => ({
          id: p.id,
          code: p.code,
          label: p.label,
          sortOrder: p.sortOrder,
          active: p.active === 1,
        })),
      });
    },
  );

  r.get("/terrace-dining-tables", requireAuth, requireAnyPermission("settings.edit"), (req: AuthedRequest, res: Response) => {
    const posId = typeof req.query.pointOfSaleId === "string" ? req.query.pointOfSaleId.trim() : "";
    if (!posId) {
      res.status(400).json({ code: "validation_error" });
      return;
    }
    const posOk = db.prepare(`SELECT 1 FROM stock_points_of_sale WHERE id = ?`).get(posId);
    if (!posOk) {
      res.status(404).json({ code: "terrace_not_found" });
      return;
    }
    const rows = db
      .prepare(
        `SELECT id, point_of_sale_id, code, label, seats, sort_order, active
         FROM dining_terrace_tables
         WHERE point_of_sale_id = ?
         ORDER BY sort_order ASC, code COLLATE NOCASE ASC`,
      )
      .all(posId) as DiningTerraceTableRow[];
    res.json({ tables: rows.map(diningTableToPublic) });
  });

  r.post(
    "/terrace-dining-tables",
    requireAuth,
    requireAnyPermission("settings.edit"),
    (req: AuthedRequest, res: Response) => {
      const parsed = postDiningTerraceTableSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ code: "validation_error" });
        return;
      }
      const codeNorm = normalizeDiningTableCode(parsed.data.code);
      if (!codeNorm || !DINING_TABLE_CODE_RE.test(codeNorm)) {
        res.status(400).json({ code: "invalid_code" });
        return;
      }
      const posOk = db
        .prepare(`SELECT 1 FROM stock_points_of_sale WHERE id = ? AND active = 1`)
        .get(parsed.data.pointOfSaleId);
      if (!posOk) {
        res.status(404).json({ code: "terrace_not_found" });
        return;
      }
      if (diningTableCodeTaken(parsed.data.pointOfSaleId, codeNorm)) {
        res.status(409).json({ code: "code_exists" });
        return;
      }
      const maxSo = (
        db
          .prepare(
            `SELECT COALESCE(MAX(sort_order), -1) AS m FROM dining_terrace_tables WHERE point_of_sale_id = ?`,
          )
          .get(parsed.data.pointOfSaleId) as { m: number }
      ).m;
      const sortOrder = parsed.data.sortOrder ?? maxSo + 1;
      const id = randomUUID();
      try {
        db.prepare(
          `INSERT INTO dining_terrace_tables (id, point_of_sale_id, code, label, seats, sort_order, active)
           VALUES (?, ?, ?, ?, ?, ?, 1)`,
        ).run(
          id,
          parsed.data.pointOfSaleId,
          codeNorm,
          parsed.data.label.trim(),
          parsed.data.seats,
          sortOrder,
        );
      } catch (e) {
        console.error(e);
        res.status(500).json({ code: "insert_failed" });
        return;
      }
      recordAudit({
        actorUserId: req.auth?.sub ?? null,
        action: "create",
        entityType: "settings",
        entityId: "dining-terrace-table",
        summary: `Table salle ${codeNorm} (${parsed.data.label.trim()}) · terrasse ${parsed.data.pointOfSaleId}`,
      });
      const row = db
        .prepare(
          `SELECT id, point_of_sale_id, code, label, seats, sort_order, active FROM dining_terrace_tables WHERE id = ?`,
        )
        .get(id) as DiningTerraceTableRow;
      res.status(201).json({ table: diningTableToPublic(row) });
    },
  );

  r.patch(
    "/terrace-dining-tables/:id",
    requireAuth,
    requireAnyPermission("settings.edit"),
    (req: AuthedRequest, res: Response) => {
      const id = typeof req.params.id === "string" ? req.params.id.trim() : "";
      if (!id) {
        res.status(400).json({ code: "validation_error" });
        return;
      }
      const parsed = patchDiningTerraceTableSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ code: "validation_error" });
        return;
      }
      const existing = db
        .prepare(
          `SELECT id, point_of_sale_id, code, label, seats, sort_order, active FROM dining_terrace_tables WHERE id = ?`,
        )
        .get(id) as DiningTerraceTableRow | undefined;
      if (!existing) {
        res.status(404).json({ code: "not_found" });
        return;
      }
      let nextCode = existing.code;
      if (parsed.data.code !== undefined) {
        const codeNorm = normalizeDiningTableCode(parsed.data.code);
        if (!codeNorm || !DINING_TABLE_CODE_RE.test(codeNorm)) {
          res.status(400).json({ code: "invalid_code" });
          return;
        }
        if (diningTableCodeTaken(existing.point_of_sale_id, codeNorm, id)) {
          res.status(409).json({ code: "code_exists" });
          return;
        }
        nextCode = codeNorm;
      }
      const nextLabel = parsed.data.label !== undefined ? parsed.data.label.trim() : existing.label;
      const nextSeats = parsed.data.seats !== undefined ? parsed.data.seats : existing.seats;
      const nextSort = parsed.data.sortOrder !== undefined ? parsed.data.sortOrder : existing.sort_order;
      let nextActive = parsed.data.active !== undefined ? (parsed.data.active ? 1 : 0) : existing.active;

      try {
        db.prepare(
          `UPDATE dining_terrace_tables SET code = ?, label = ?, seats = ?, sort_order = ?, active = ? WHERE id = ?`,
        ).run(nextCode, nextLabel, nextSeats, nextSort, nextActive, id);
      } catch (e) {
        console.error(e);
        res.status(500).json({ code: "update_failed" });
        return;
      }
      recordAudit({
        actorUserId: req.auth?.sub ?? null,
        action: "update",
        entityType: "settings",
        entityId: "dining-terrace-table",
        summary: `Table salle ${nextCode} mise à jour`,
      });
      const row = db
        .prepare(
          `SELECT id, point_of_sale_id, code, label, seats, sort_order, active FROM dining_terrace_tables WHERE id = ?`,
        )
        .get(id) as DiningTerraceTableRow;
      res.json({ table: diningTableToPublic(row) });
    },
  );

  r.delete(
    "/terrace-dining-tables/:id",
    requireAuth,
    requireAnyPermission("settings.edit"),
    (req: AuthedRequest, res: Response) => {
      const id = typeof req.params.id === "string" ? req.params.id.trim() : "";
      if (!id) {
        res.status(400).json({ code: "validation_error" });
        return;
      }
      const existing = db
        .prepare(`SELECT code FROM dining_terrace_tables WHERE id = ?`)
        .get(id) as { code: string } | undefined;
      if (!existing) {
        res.status(404).json({ code: "not_found" });
        return;
      }
      db.prepare(`DELETE FROM dining_terrace_tables WHERE id = ?`).run(id);
      recordAudit({
        actorUserId: req.auth?.sub ?? null,
        action: "delete",
        entityType: "settings",
        entityId: "dining-terrace-table",
        summary: `Table salle ${existing.code} supprimée`,
      });
      res.status(204).end();
    },
  );

  return r;
}
