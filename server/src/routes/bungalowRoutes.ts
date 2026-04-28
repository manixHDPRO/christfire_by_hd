import { randomUUID } from "node:crypto";
import type { Request, Response, Router } from "express";
import { Router as createRouter } from "express";
import { z } from "zod";
import { recordAudit } from "../auditLog.js";
import { db } from "../db.js";
import { requireAnyPermission } from "../middleware/requirePermission.js";
import { requireAuth, type AuthedRequest } from "../middleware/requireAuth.js";
import { LODGING_MODULE_CODES } from "../permissionCodes.js";
import { roleHasAnyPermission, roleHasPermission } from "../permissions.js";

const categoryEnum = z.enum(["Premium", "Deluxe", "Standard"]);
const statusEnum = z.enum(["Disponible", "Réservé", "Occupé", "Maintenance", "Hors service"]);
const housekeepingEnum = z.enum(["Propre", "À nettoyer", "En cours", "Contrôlé"]);

const createBungalowSchema = z.object({
  code: z.string().min(1).max(40).trim(),
  label: z.string().min(1).max(120).trim(),
  category: categoryEnum,
  pricePerNightUsd: z.number().int().min(0).max(999_999).nullable().optional(),
  rooms: z.union([z.literal(1), z.literal(2)]),
  capacity: z.union([z.literal(1), z.literal(2), z.literal(3)]),
  description: z.string().max(2000).optional().default(""),
  image: z.string().max(2000).optional().default(""),
  amenities: z.array(z.string().max(100)).max(40).optional().default([]),
  status: statusEnum,
  housekeepingStatus: housekeepingEnum.optional().default("Propre"),
});

const updateBungalowSchema = createBungalowSchema.partial();

type BungalowRow = {
  id: string;
  code: string;
  label: string;
  category: string;
  price_per_night_usd: number | null;
  rooms: number;
  capacity: number;
  description: string;
  image: string;
  amenities_json: string;
  status: string;
  housekeeping_status: string;
  created_at?: string | null;
  updated_at?: string | null;
};

const BUNGALOW_SELECT = `id, code, label, category, price_per_night_usd, rooms, capacity, description, image, amenities_json, status,
 COALESCE(housekeeping_status, 'Propre') AS housekeeping_status, created_at, updated_at`;

function parseAmenities(json: string): string[] {
  try {
    const p = JSON.parse(json) as unknown;
    if (!Array.isArray(p)) return [];
    return p.filter((x): x is string => typeof x === "string");
  } catch {
    return [];
  }
}

function normalizeHousekeepingStatus(raw: string): "Propre" | "À nettoyer" | "En cours" | "Contrôlé" {
  if (raw === "À nettoyer" || raw === "En cours" || raw === "Contrôlé" || raw === "Propre") return raw;
  return "Propre";
}

function rowToPublic(row: BungalowRow) {
  const hk = normalizeHousekeepingStatus(row.housekeeping_status);
  const base = {
    id: row.id,
    code: row.code,
    label: row.label,
    category: row.category,
    rooms: row.rooms,
    capacity: row.capacity,
    description: row.description ?? "",
    image: row.image ?? "",
    amenities: parseAmenities(row.amenities_json),
    status: row.status,
    housekeepingStatus: hk,
  };
  const dates = {
    createdAt: row.created_at ?? "",
    updatedAt: row.updated_at ?? row.created_at ?? "",
  };
  if (row.price_per_night_usd != null) {
    return { ...base, pricePerNightUsd: row.price_per_night_usd, ...dates };
  }
  return { ...base, ...dates };
}

function codeTaken(code: string, excludeId?: string): boolean {
  const row = db.prepare("SELECT id FROM bungalows WHERE code = ? COLLATE NOCASE").get(code) as
    | { id: string }
    | undefined;
  if (!row) return false;
  if (excludeId && row.id === excludeId) return false;
  return true;
}

export function bungalowRoutes(): Router {
  const r = createRouter();

  r.get("/", requireAuth, requireAnyPermission(...LODGING_MODULE_CODES), (_req: Request, res: Response) => {
    const rows = db
      .prepare(`SELECT ${BUNGALOW_SELECT} FROM bungalows ORDER BY code COLLATE NOCASE ASC`)
      .all() as BungalowRow[];
    res.json({ bungalows: rows.map(rowToPublic) });
  });

  r.get("/:id", requireAuth, requireAnyPermission(...LODGING_MODULE_CODES), (req: Request, res: Response) => {
    const row = db.prepare(`SELECT ${BUNGALOW_SELECT} FROM bungalows WHERE id = ?`).get(req.params.id) as
      | BungalowRow
      | undefined;
    if (!row) {
      res.status(404).json({ code: "not_found" });
      return;
    }
    res.json({ bungalow: rowToPublic(row) });
  });

  r.post("/", requireAuth, requireAnyPermission("lodging.bungalows"), (req: AuthedRequest, res: Response) => {
    const parsed = createBungalowSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ code: "validation_error" });
      return;
    }
    const code = parsed.data.code;
    if (codeTaken(code)) {
      res.status(409).json({ code: "code_taken" });
      return;
    }
    const id = randomUUID();
    const amenities_json = JSON.stringify(parsed.data.amenities);
    const pricePerNight =
      parsed.data.pricePerNightUsd === undefined ? null : parsed.data.pricePerNightUsd;
    try {
      db.prepare(
        `INSERT INTO bungalows (id, code, label, category, price_per_night_usd, rooms, capacity, description, image, amenities_json, status, housekeeping_status, created_at, updated_at)
         VALUES (@id, @code, @label, @category, @price_per_night_usd, @rooms, @capacity, @description, @image, @amenities_json, @status, @housekeeping_status, datetime('now'), datetime('now'))`,
      ).run({
        id,
        code,
        label: parsed.data.label,
        category: parsed.data.category,
        price_per_night_usd: pricePerNight,
        rooms: parsed.data.rooms,
        capacity: parsed.data.capacity,
        description: parsed.data.description,
        image: parsed.data.image,
        amenities_json,
        status: parsed.data.status,
        housekeeping_status: parsed.data.housekeepingStatus,
      });
    } catch (e) {
      console.error(e);
      res.status(500).json({ code: "server_error" });
      return;
    }
    const row = db.prepare(`SELECT ${BUNGALOW_SELECT} FROM bungalows WHERE id = ?`).get(id) as BungalowRow;
    recordAudit({
      actorUserId: req.auth?.sub ?? null,
      action: "create",
      entityType: "bungalow",
      entityId: id,
      summary: `Bungalow créé : ${code} — ${parsed.data.label}`,
    });
    res.status(201).json({ bungalow: rowToPublic(row) });
  });

  r.patch("/:id", requireAuth, (req: AuthedRequest, res: Response) => {
    const parsed = updateBungalowSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ code: "validation_error" });
      return;
    }
    const role = req.auth?.role;
    if (!role) {
      res.status(401).json({ code: "unauthorized" });
      return;
    }
    const dataKeys = Object.keys(parsed.data);
    if (dataKeys.length === 0) {
      if (!roleHasPermission(role, "lodging.bungalows")) {
        res.status(403).json({ code: "forbidden" });
        return;
      }
    } else {
      const onlyHk = dataKeys.every((k) => k === "housekeepingStatus");
      if (onlyHk) {
        if (!roleHasAnyPermission(role, ["lodging.bungalows", "lodging.housekeeping"])) {
          res.status(403).json({ code: "forbidden" });
          return;
        }
      } else if (!roleHasPermission(role, "lodging.bungalows")) {
        res.status(403).json({ code: "forbidden" });
        return;
      }
    }
    const current = db.prepare(`SELECT ${BUNGALOW_SELECT} FROM bungalows WHERE id = ?`).get(req.params.id) as
      | BungalowRow
      | undefined;
    if (!current) {
      res.status(404).json({ code: "not_found" });
      return;
    }
    const nextCode = parsed.data.code ?? current.code;
    if (parsed.data.code !== undefined && codeTaken(nextCode, current.id)) {
      res.status(409).json({ code: "code_taken" });
      return;
    }
    const nextPricePerNight =
      parsed.data.pricePerNightUsd !== undefined ? parsed.data.pricePerNightUsd : (current.price_per_night_usd ?? null);
    const nextHousekeeping = normalizeHousekeepingStatus(
      parsed.data.housekeepingStatus ?? current.housekeeping_status,
    );
    const next: BungalowRow = {
      id: current.id,
      code: nextCode,
      label: parsed.data.label ?? current.label,
      category: parsed.data.category ?? current.category,
      price_per_night_usd: nextPricePerNight ?? null,
      rooms: parsed.data.rooms ?? current.rooms,
      capacity: parsed.data.capacity ?? current.capacity,
      description: parsed.data.description ?? current.description,
      image: parsed.data.image ?? current.image,
      amenities_json:
        parsed.data.amenities !== undefined ? JSON.stringify(parsed.data.amenities) : current.amenities_json,
      status: parsed.data.status ?? current.status,
      housekeeping_status: nextHousekeeping,
    };
    try {
      db.prepare(
        `UPDATE bungalows SET code=@code, label=@label, category=@category, price_per_night_usd=@price_per_night_usd,
         rooms=@rooms, capacity=@capacity, description=@description, image=@image, amenities_json=@amenities_json, status=@status,
         housekeeping_status=@housekeeping_status, updated_at=datetime('now') WHERE id=@id`,
      ).run({
        id: next.id,
        code: next.code,
        label: next.label,
        category: next.category,
        price_per_night_usd: next.price_per_night_usd,
        rooms: next.rooms,
        capacity: next.capacity,
        description: next.description,
        image: next.image,
        amenities_json: next.amenities_json,
        status: next.status,
        housekeeping_status: next.housekeeping_status,
      });
    } catch (e) {
      console.error(e);
      res.status(500).json({ code: "server_error" });
      return;
    }
    const row = db.prepare(`SELECT ${BUNGALOW_SELECT} FROM bungalows WHERE id = ?`).get(current.id) as BungalowRow;
    recordAudit({
      actorUserId: req.auth?.sub ?? null,
      action: "update",
      entityType: "bungalow",
      entityId: current.id,
      summary: `Bungalow modifié : ${row.code} — ${row.label}`,
    });
    res.json({ bungalow: rowToPublic(row) });
  });

  return r;
}
