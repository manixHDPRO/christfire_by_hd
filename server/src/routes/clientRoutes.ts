import { randomUUID } from "node:crypto";
import type { Request, Response, Router } from "express";
import { Router as createRouter } from "express";
import { z } from "zod";
import { recordAudit } from "../auditLog.js";
import { localBusinessDateNow, requireCashDayOpenForRole } from "../cashDayOpen.js";
import { db } from "../db.js";
import { nominalToUsdEquivalent, parsePaymentCurrency, type PaymentCurrency } from "../paymentFx.js";
import { hardDeleteClient } from "../hardDelete.js";
import { requireAuth, type AuthedRequest } from "../middleware/requireAuth.js";
import { requireAnyPermission } from "../middleware/requirePermission.js";

const PASSAGE_PLACEHOLDER_DOMAIN = "sans-email.christfire";

const CLIENT_SELECT =
  "id, name, email, phone, notes, client_profile, entry_fee_usd, entry_fee_paid_usd, visitor_party_count, visitor_visit_kind, visitor_adults_count, visitor_minors_count, created_at, updated_at";

const profileCodeField = z
  .string()
  .min(1)
  .max(48)
  .regex(/^[a-z0-9_]+$/, "code profil");

const entryFeeField = z.coerce.number().int().min(0).max(999_999_999).optional();

const visitorVisitKindField = z.enum(["individual", "group", "family"]).optional();
const visitorAdultsField = z.coerce.number().int().min(0).max(999).optional();
const visitorMinorsField = z.coerce.number().int().min(0).max(999).optional();

const createClientSchema = z.object({
  name: z.string().min(1).max(120).trim(),
  email: z.string().max(255).optional().default(""),
  phone: z.string().max(40).optional().default(""),
  notes: z.string().max(2000).optional().default(""),
  clientProfile: profileCodeField.optional().default("hebergement"),
  entryFeeUsd: entryFeeField,
  visitorVisitKind: visitorVisitKindField,
  visitorAdultsCount: visitorAdultsField,
  visitorMinorsCount: visitorMinorsField,
});

const updateClientSchema = z.object({
  name: z.string().min(1).max(120).trim().optional(),
  email: z.string().max(255).optional(),
  phone: z.string().max(40).optional(),
  notes: z.string().max(2000).optional(),
  clientProfile: profileCodeField.optional(),
  entryFeeUsd: entryFeeField,
  visitorVisitKind: visitorVisitKindField,
  visitorAdultsCount: visitorAdultsField,
  visitorMinorsCount: visitorMinorsField,
});

const visitorEntryPaymentSchema = z
  .object({
    amount: z.number().int().min(1).max(99_999_999).optional(),
    amountUsd: z.number().int().min(1).max(99_999_999).optional(),
    currency: z.enum(["USD", "CDF"]).optional().default("USD"),
    method: z.enum(["Espèces", "Carte", "Virement", "Autre"]).optional().default("Espèces"),
    note: z.string().max(500).optional().default(""),
  })
  .superRefine((data, ctx) => {
    if (data.amount === undefined && data.amountUsd === undefined) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "amount_required", path: ["amount"] });
    }
  });

type ClientRow = {
  id: string;
  name: string;
  email: string;
  phone: string;
  notes: string;
  client_profile: string;
  entry_fee_usd: number;
  entry_fee_paid_usd: number;
  visitor_party_count?: number | null;
  visitor_visit_kind?: string | null;
  visitor_adults_count?: number | null;
  visitor_minors_count?: number | null;
  created_at: string;
  updated_at?: string | null;
};

function getFirstProfileCode(): string {
  const row = db
    .prepare("SELECT code FROM client_profile_types ORDER BY sort_order ASC, code ASC LIMIT 1")
    .get() as { code: string } | undefined;
  return row?.code ?? "hebergement";
}

function profileTypeExists(code: string): boolean {
  return !!db.prepare("SELECT 1 FROM client_profile_types WHERE code = ?").get(code);
}

function isEmailOptionalForProfile(code: string): boolean {
  const row = db
    .prepare("SELECT email_optional FROM client_profile_types WHERE code = ?")
    .get(code) as { email_optional: number } | undefined;
  return row?.email_optional === 1;
}

function appliesEntryFeeForProfile(code: string): boolean {
  const row = db
    .prepare("SELECT applies_entry_fee FROM client_profile_types WHERE code = ?")
    .get(code) as { applies_entry_fee: number } | undefined;
  return row?.applies_entry_fee === 1;
}

/** Tarifs droit d’entrée visiteur (USD / personne), Paramètres → Tarification. */
function getVisitorEntryRates(): { adultUsd: number; minorUsd: number } {
  const row = db
    .prepare("SELECT price_usd, adult_price_usd, minor_price_usd FROM app_visitor_entry WHERE id = 1")
    .get() as { price_usd: number; adult_price_usd?: number; minor_price_usd?: number } | undefined;
  const adult = Math.max(1, Math.floor(Number(row?.adult_price_usd ?? row?.price_usd ?? 10)));
  const minor = Math.max(1, Math.floor(Number(row?.minor_price_usd ?? 5)));
  return { adultUsd: adult, minorUsd: minor };
}

/** Prix unitaire adulte (individuel = 1 adulte). */
function getVisitorEntryDefaultUsd(): number {
  return getVisitorEntryRates().adultUsd;
}

function placeholderPassageEmail(): string {
  return `passage-${randomUUID()}@${PASSAGE_PLACEHOLDER_DOMAIN}`;
}

function normalizeEmailForProfile(
  profile: string,
  rawEmail: string,
): { ok: true; email: string } | { ok: false } {
  const trimmed = rawEmail.trim().toLowerCase();
  if (isEmailOptionalForProfile(profile)) {
    if (!trimmed) return { ok: true, email: placeholderPassageEmail() };
    const p = z.string().email().safeParse(trimmed);
    if (!p.success) return { ok: false };
    return { ok: true, email: p.data };
  }
  const p = z.string().email().safeParse(trimmed);
  if (!p.success) return { ok: false };
  return { ok: true, email: p.data.trim().toLowerCase() };
}

function rowToPublic(row: ClientRow) {
  const prof = row.client_profile;
  const clientProfile = profileTypeExists(prof) ? prof : getFirstProfileCode();
  const fee = Number(row.entry_fee_usd ?? 0);
  const paid = Number(row.entry_fee_paid_usd ?? 0);
  const applies = appliesEntryFeeForProfile(clientProfile);
  const kindRaw = row.visitor_visit_kind;
  const kind =
    applies && (kindRaw === "individual" || kindRaw === "group" || kindRaw === "family") ? kindRaw : null;
  let visitorAdultsCount: number | null = null;
  let visitorMinorsCount: number | null = null;
  let visitorPartyCount: number | null = null;
  if (applies && kind === "individual") {
    visitorPartyCount = 1;
  } else if (applies && (kind === "group" || kind === "family")) {
    const a = Math.max(0, Math.floor(Number(row.visitor_adults_count ?? 0)));
    const m = Math.max(0, Math.floor(Number(row.visitor_minors_count ?? 0)));
    visitorAdultsCount = a;
    visitorMinorsCount = m;
    const t = a + m;
    visitorPartyCount = t >= 1 ? Math.min(999, t) : null;
  } else if (applies) {
    const partyRaw = row.visitor_party_count;
    visitorPartyCount =
      partyRaw != null && Number.isFinite(Number(partyRaw)) && Math.floor(Number(partyRaw)) >= 1
        ? Math.min(999, Math.floor(Number(partyRaw)))
        : null;
  }
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    phone: row.phone,
    notes: row.notes ?? "",
    clientProfile,
    entryFeeUsd: applies ? fee : 0,
    entryFeePaidUsd: applies ? Math.min(Math.max(0, paid), Math.max(0, fee)) : 0,
    visitorVisitKind: applies ? kind : null,
    visitorAdultsCount: applies && (kind === "group" || kind === "family") ? visitorAdultsCount : null,
    visitorMinorsCount: applies && (kind === "group" || kind === "family") ? visitorMinorsCount : null,
    visitorPartyCount,
    createdAt: row.created_at ?? "",
    updatedAt: row.updated_at ?? row.created_at ?? "",
  };
}

const readClients = requireAnyPermission(
  "directory.clients",
  "lodging.reservations",
  "lodging.stay_reception",
  "lodging.reception_cash",
);
const writeClients = requireAnyPermission("directory.clients");
/** Encaissement droit d’entrée visiteur à la caisse (sans droit d’édition complète de la fiche). */
const visitorEntryPaymentActors = requireAnyPermission(
  "directory.clients",
  "lodging.reservations",
  "lodging.stay_reception",
  "lodging.reception_cash",
);

export function clientRoutes(): Router {
  const r = createRouter();

  r.get("/", requireAuth, readClients, (_req: Request, res: Response) => {
    const rows = db
      .prepare(
        `SELECT ${CLIENT_SELECT} FROM clients ORDER BY name COLLATE NOCASE ASC`,
      )
      .all() as ClientRow[];
    res.json({ clients: rows.map(rowToPublic) });
  });

  r.get("/visitor-entry-payments-ledger", requireAuth, readClients, (_req: Request, res: Response) => {
    const raw = db
      .prepare(
        `SELECT id, client_id AS clientId, amount_usd AS amountUsd,
                COALESCE(amount_nominal, amount_usd) AS amountNominal,
                COALESCE(currency, 'USD') AS currency,
                method, note, created_at AS createdAt
         FROM visitor_entry_payment_ledger
         ORDER BY datetime(created_at) DESC, id DESC`,
      )
      .all() as {
      id: string;
      clientId: string;
      amountUsd: number;
      method: string;
      note: string;
      createdAt: string;
    }[];
    res.json({ payments: raw });
  });

  r.get("/:id/visitor-entry-payments", requireAuth, readClients, (req: Request, res: Response) => {
    const id = typeof req.params.id === "string" ? req.params.id : req.params.id[0];
    const exists = db.prepare("SELECT 1 AS x FROM clients WHERE id = ?").get(id) as { x: number } | undefined;
    if (!exists) {
      res.status(404).json({ code: "not_found" });
      return;
    }
    const raw = db
      .prepare(
        `SELECT id, client_id AS clientId, amount_usd AS amountUsd,
                COALESCE(amount_nominal, amount_usd) AS amountNominal,
                COALESCE(currency, 'USD') AS currency,
                method, note, created_at AS createdAt
         FROM visitor_entry_payment_ledger
         WHERE client_id = ?
         ORDER BY datetime(created_at) DESC, id DESC`,
      )
      .all(id) as {
      id: string;
      clientId: string;
      amountUsd: number;
      method: string;
      note: string;
      createdAt: string;
    }[];
    res.json({ payments: raw });
  });

  r.get("/:id", requireAuth, readClients, (req: Request, res: Response) => {
    const row = db
      .prepare(
        `SELECT ${CLIENT_SELECT} FROM clients WHERE id = ?`,
      )
      .get(req.params.id) as ClientRow | undefined;
    if (!row) {
      res.status(404).json({ code: "not_found" });
      return;
    }
    res.json({ client: rowToPublic(row) });
  });

  r.post("/", requireAuth, writeClients, (req: AuthedRequest, res: Response) => {
    const parsed = createClientSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ code: "validation_error" });
      return;
    }
    const profile = parsed.data.clientProfile;
    if (!profileTypeExists(profile)) {
      res.status(400).json({ code: "validation_error" });
      return;
    }
    const norm = normalizeEmailForProfile(profile, parsed.data.email ?? "");
    if (!norm.ok) {
      res.status(400).json({ code: "validation_error" });
      return;
    }
    const email = norm.email;
    const taken = db.prepare("SELECT 1 AS x FROM clients WHERE email = ? COLLATE NOCASE").get(email) as
      | { x: number }
      | undefined;
    if (taken) {
      res.status(409).json({ code: "email_taken" });
      return;
    }

    const hasVisitorMeta =
      parsed.data.visitorVisitKind !== undefined ||
      parsed.data.visitorAdultsCount !== undefined ||
      parsed.data.visitorMinorsCount !== undefined;
    if (!appliesEntryFeeForProfile(profile) && hasVisitorMeta) {
      res.status(400).json({ code: "validation_error" });
      return;
    }
    const appliesFee = appliesEntryFeeForProfile(profile);
    let visitor_party_count: number | null = null;
    let visitor_visit_kind: string | null = null;
    let visitor_adults_count: number | null = null;
    let visitor_minors_count: number | null = null;
    if (appliesFee) {
      const k = parsed.data.visitorVisitKind;
      if (!k || (k !== "individual" && k !== "group" && k !== "family")) {
        res.status(400).json({ code: "validation_error" });
        return;
      }
      visitor_visit_kind = k;
      if (k === "individual") {
        visitor_party_count = 1;
      } else {
        const ad = parsed.data.visitorAdultsCount;
        const mi = parsed.data.visitorMinorsCount;
        if (ad === undefined || mi === undefined || ad < 0 || mi < 0 || ad + mi < 1) {
          res.status(400).json({ code: "validation_error" });
          return;
        }
        visitor_adults_count = ad;
        visitor_minors_count = mi;
        visitor_party_count = Math.min(999, ad + mi);
      }
    }

    const rates = getVisitorEntryRates();
    let entry_fee_usd = 0;
    if (appliesFee) {
      const k = visitor_visit_kind as "individual" | "group" | "family";
      if (k === "individual") {
        const bodyFee = parsed.data.entryFeeUsd;
        entry_fee_usd =
          bodyFee === undefined ? rates.adultUsd : Math.max(1, Math.floor(Number(bodyFee)));
      } else {
        const ad = visitor_adults_count ?? 0;
        const mi = visitor_minors_count ?? 0;
        entry_fee_usd = Math.max(1, ad * rates.adultUsd + mi * rates.minorUsd);
      }
    }
    if (appliesFee && entry_fee_usd < 1) {
      res.status(400).json({ code: "validation_error" });
      return;
    }

    const id = randomUUID();
    try {
      db.prepare(
        `INSERT INTO clients (id, name, email, phone, notes, client_profile, entry_fee_usd, entry_fee_paid_usd, visitor_party_count, visitor_visit_kind, visitor_adults_count, visitor_minors_count, created_at, updated_at)
         VALUES (@id, @name, @email, @phone, @notes, @client_profile, @entry_fee_usd, 0, @visitor_party_count, @visitor_visit_kind, @visitor_adults_count, @visitor_minors_count, datetime('now'), datetime('now'))`,
      ).run({
        id,
        name: parsed.data.name,
        email,
        phone: parsed.data.phone.trim(),
        notes: parsed.data.notes,
        client_profile: profile,
        entry_fee_usd,
        visitor_party_count,
        visitor_visit_kind,
        visitor_adults_count,
        visitor_minors_count,
      });
    } catch (e) {
      console.error(e);
      res.status(500).json({ code: "server_error" });
      return;
    }

    const row = db
      .prepare(
        `SELECT ${CLIENT_SELECT} FROM clients WHERE id = ?`,
      )
      .get(id) as ClientRow;
    recordAudit({
      actorUserId: req.auth?.sub ?? null,
      action: "create",
      entityType: "client",
      entityId: id,
      summary: `Client créé : ${parsed.data.name} (${email})`,
    });
    res.status(201).json({ client: rowToPublic(row) });
  });

  r.post("/:id/visitor-entry-payment", requireAuth, visitorEntryPaymentActors, (req: AuthedRequest, res: Response) => {
    const id = typeof req.params.id === "string" ? req.params.id : req.params.id[0];
    const parsed = visitorEntryPaymentSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ code: "validation_error" });
      return;
    }
    const row = db
      .prepare(
        `SELECT ${CLIENT_SELECT} FROM clients WHERE id = ?`,
      )
      .get(id) as ClientRow | undefined;
    if (!row) {
      res.status(404).json({ code: "not_found" });
      return;
    }
    const profile = profileTypeExists(row.client_profile) ? row.client_profile : getFirstProfileCode();
    if (!appliesEntryFeeForProfile(profile)) {
      res.status(400).json({ code: "not_visitor_profile" });
      return;
    }
    const due = Math.max(0, Math.floor(Number(row.entry_fee_usd ?? 0)));
    const paid = Math.max(0, Math.floor(Number(row.entry_fee_paid_usd ?? 0)));
    if (due < 1) {
      res.status(400).json({ code: "no_entry_fee" });
      return;
    }
    const reste = due - paid;
    if (reste <= 0) {
      res.status(400).json({ code: "already_paid" });
      return;
    }
    const nominal = Math.floor(parsed.data.amount ?? parsed.data.amountUsd ?? 0);
    const currency: PaymentCurrency = parsePaymentCurrency(parsed.data.currency);
    const incUsd = nominalToUsdEquivalent(nominal, currency);
    if (currency === "CDF" && incUsd < 1) {
      res.status(400).json({ code: "cdf_amount_too_small" });
      return;
    }
    if (incUsd > reste) {
      res.status(400).json({ code: "amount_exceeds_balance" });
      return;
    }
    const inc = incUsd;
    const role = req.auth?.role ?? "";
    if (!requireCashDayOpenForRole(role, localBusinessDateNow(), res)) return;

    try {
      const txn = db.transaction(() => {
        db.prepare("UPDATE clients SET entry_fee_paid_usd = entry_fee_paid_usd + @inc WHERE id = @id").run({
          id,
          inc,
        });
        db.prepare(
          "UPDATE clients SET entry_fee_paid_usd = MIN(COALESCE(entry_fee_paid_usd, 0), entry_fee_usd) WHERE id = ?",
        ).run(id);
        db.prepare(
            `INSERT INTO visitor_entry_payment_ledger (id, client_id, amount_usd, amount_nominal, currency, method, note, received_by_user_id, created_at)
             VALUES (@id, @client_id, @amount_usd, @amount_nominal, @currency, @method, @note, @received_by_user_id, datetime('now'))`,
          )
          .run({
            id: randomUUID(),
            client_id: id,
            amount_usd: inc,
            amount_nominal: nominal,
            currency,
            method: parsed.data.method,
            note: parsed.data.note,
            received_by_user_id: req.auth?.sub ?? null,
          });
      });
      txn();
    } catch (e) {
      console.error(e);
      res.status(500).json({ code: "update_failed" });
      return;
    }
    db.prepare("UPDATE clients SET updated_at = datetime('now') WHERE id = ?").run(id);
    recordAudit({
      actorUserId: req.auth?.sub ?? null,
      action: "update",
      entityType: "client",
      entityId: id,
      summary:
        currency === "CDF"
          ? `Droit d’entrée : +${nominal.toLocaleString("fr-FR")} FC (equiv. ${inc} USD) (${parsed.data.method}) — ${row.name}`
          : `Droit d’entrée : +${inc} USD (${parsed.data.method}) — ${row.name}`,
    });
    const updated = db
      .prepare(
        `SELECT ${CLIENT_SELECT} FROM clients WHERE id = ?`,
      )
      .get(id) as ClientRow;
    res.json({ client: rowToPublic(updated) });
  });

  r.patch("/:id", requireAuth, writeClients, (req: AuthedRequest, res: Response) => {
    const id = typeof req.params.id === "string" ? req.params.id : req.params.id[0];
    const parsed = updateClientSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ code: "validation_error" });
      return;
    }
    const body = parsed.data;
    const hasField =
      body.name !== undefined ||
      body.email !== undefined ||
      body.phone !== undefined ||
      body.notes !== undefined ||
      body.clientProfile !== undefined ||
      body.entryFeeUsd !== undefined ||
      body.visitorVisitKind !== undefined ||
      body.visitorAdultsCount !== undefined ||
      body.visitorMinorsCount !== undefined;
    if (!hasField) {
      res.status(400).json({ code: "validation_error" });
      return;
    }

    const target = db
      .prepare(
        `SELECT ${CLIENT_SELECT} FROM clients WHERE id = ?`,
      )
      .get(id) as ClientRow | undefined;
    if (!target) {
      res.status(404).json({ code: "not_found" });
      return;
    }

    const nextProfile = body.clientProfile ?? target.client_profile;
    if (!profileTypeExists(nextProfile)) {
      res.status(400).json({ code: "validation_error" });
      return;
    }

    if (body.entryFeeUsd !== undefined && !appliesEntryFeeForProfile(nextProfile)) {
      res.status(400).json({ code: "validation_error" });
      return;
    }
    const wantVisitorComposition =
      body.visitorVisitKind !== undefined ||
      body.visitorAdultsCount !== undefined ||
      body.visitorMinorsCount !== undefined;
    if (wantVisitorComposition && !appliesEntryFeeForProfile(nextProfile)) {
      res.status(400).json({ code: "validation_error" });
      return;
    }

    const isSentinel = (e: string) => e.toLowerCase().endsWith(`@${PASSAGE_PLACEHOLDER_DOMAIN}`);

    if (
      body.clientProfile !== undefined &&
      body.email === undefined &&
      !isEmailOptionalForProfile(nextProfile) &&
      isSentinel(target.email)
    ) {
      res.status(400).json({ code: "validation_error" });
      return;
    }

    let emailToSet: string | undefined;
    if (body.email !== undefined) {
      const norm = normalizeEmailForProfile(nextProfile, body.email);
      if (!norm.ok) {
        res.status(400).json({ code: "validation_error" });
        return;
      }
      if (norm.email.toLowerCase() !== target.email.toLowerCase()) {
        const taken = db
          .prepare("SELECT 1 AS x FROM clients WHERE email = ? COLLATE NOCASE AND id != ?")
          .get(norm.email, id) as { x: number } | undefined;
        if (taken) {
          res.status(409).json({ code: "email_taken" });
          return;
        }
        emailToSet = norm.email;
      }
    }

    const sets: string[] = [];
    const params: Record<string, string | number | null> = { id };

    if (body.name !== undefined) {
      sets.push("name = @name");
      params.name = body.name;
    }
    if (emailToSet !== undefined) {
      sets.push("email = @email");
      params.email = emailToSet;
    }
    if (body.phone !== undefined) {
      sets.push("phone = @phone");
      params.phone = body.phone.trim();
    }
    if (body.notes !== undefined) {
      sets.push("notes = @notes");
      params.notes = body.notes;
    }
    if (body.clientProfile !== undefined) {
      sets.push("client_profile = @client_profile");
      params.client_profile = body.clientProfile;
    }

    if (body.clientProfile !== undefined || body.entryFeeUsd !== undefined) {
      if (!appliesEntryFeeForProfile(nextProfile)) {
        if (Number(target.entry_fee_usd) !== 0 || Number(target.entry_fee_paid_usd ?? 0) !== 0) {
          sets.push("entry_fee_usd = @entry_fee_usd");
          params.entry_fee_usd = 0;
          sets.push("entry_fee_paid_usd = 0");
        }
        if (body.clientProfile !== undefined) {
          sets.push("visitor_party_count = NULL");
          sets.push("visitor_visit_kind = NULL");
          sets.push("visitor_adults_count = NULL");
          sets.push("visitor_minors_count = NULL");
        }
      } else if (!wantVisitorComposition) {
        const fromDefault = getVisitorEntryDefaultUsd();
        const fromTarget = Number(target.entry_fee_usd);
        let nextFee: number;
        if (body.entryFeeUsd !== undefined) {
          nextFee = body.entryFeeUsd;
        } else if (body.clientProfile !== undefined && body.clientProfile !== target.client_profile) {
          nextFee = fromDefault >= 1 ? fromDefault : fromTarget >= 1 ? fromTarget : 0;
        } else {
          nextFee = fromTarget >= 1 ? fromTarget : fromDefault >= 1 ? fromDefault : 0;
        }
        if (nextFee < 1) {
          res.status(400).json({ code: "validation_error" });
          return;
        }
        if (nextFee !== fromTarget || body.clientProfile !== undefined) {
          sets.push("entry_fee_usd = @entry_fee_usd");
          params.entry_fee_usd = nextFee;
          /** Nouveau montant dû : les encaissements précédents concernent l’ancienne « facture » visiteur. */
          if (nextFee !== fromTarget) {
            sets.push("entry_fee_paid_usd = 0");
          }
        }
      }
    }

    if (wantVisitorComposition && appliesEntryFeeForProfile(nextProfile)) {
      const kNext =
        body.visitorVisitKind ??
        (typeof target.visitor_visit_kind === "string" ? target.visitor_visit_kind : null);
      if (typeof kNext !== "string" || !["individual", "group", "family"].includes(kNext)) {
        res.status(400).json({ code: "validation_error" });
        return;
      }
      let nextParty: number | null = null;
      let nextAdults: number | null = null;
      let nextMinors: number | null = null;
      if (kNext === "individual") {
        nextParty = 1;
        nextAdults = null;
        nextMinors = null;
      } else {
        const ad =
          body.visitorAdultsCount !== undefined
            ? body.visitorAdultsCount
            : target.visitor_adults_count != null
              ? Math.floor(Number(target.visitor_adults_count))
              : undefined;
        const mi =
          body.visitorMinorsCount !== undefined
            ? body.visitorMinorsCount
            : target.visitor_minors_count != null
              ? Math.floor(Number(target.visitor_minors_count))
              : undefined;
        if (ad === undefined || mi === undefined || ad < 0 || mi < 0 || ad + mi < 1) {
          res.status(400).json({ code: "validation_error" });
          return;
        }
        nextAdults = ad;
        nextMinors = mi;
        nextParty = Math.min(999, ad + mi);
      }
      sets.push("visitor_visit_kind = @visitor_visit_kind");
      params.visitor_visit_kind = kNext;
      sets.push("visitor_adults_count = @visitor_adults_count");
      params.visitor_adults_count = nextAdults;
      sets.push("visitor_minors_count = @visitor_minors_count");
      params.visitor_minors_count = nextMinors;
      sets.push("visitor_party_count = @visitor_party_count");
      params.visitor_party_count = nextParty;
      const rates = getVisitorEntryRates();
      const prevEntryDue = Math.floor(Number(target.entry_fee_usd ?? 0));
      let newEntryDue: number;
      if (kNext === "individual") {
        newEntryDue =
          body.entryFeeUsd !== undefined ? Math.max(1, Math.floor(body.entryFeeUsd)) : rates.adultUsd;
        sets.push("entry_fee_usd = @entry_fee_usd");
        params.entry_fee_usd = newEntryDue;
      } else {
        newEntryDue = Math.max(1, nextAdults! * rates.adultUsd + nextMinors! * rates.minorUsd);
        sets.push("entry_fee_usd = @entry_fee_usd");
        params.entry_fee_usd = newEntryDue;
      }
      /** Nouvelle visite ou nouveau tarif dû : ne pas imputer l’ancien paiement au nouveau montant (évite 90 − 70 = 20). */
      if (newEntryDue !== prevEntryDue) {
        sets.push("entry_fee_paid_usd = 0");
      }
    }

    if (sets.length === 0) {
      res.status(400).json({ code: "validation_error" });
      return;
    }

    sets.push("updated_at = datetime('now')");

    try {
      db.prepare(`UPDATE clients SET ${sets.join(", ")} WHERE id = @id`).run(params);
      db.prepare(
        "UPDATE clients SET entry_fee_paid_usd = MIN(COALESCE(entry_fee_paid_usd, 0), COALESCE(entry_fee_usd, 0)) WHERE id = ?",
      ).run(id);
    } catch (e) {
      console.error(e);
      res.status(500).json({ code: "update_failed" });
      return;
    }

    const row = db
      .prepare(
        `SELECT ${CLIENT_SELECT} FROM clients WHERE id = ?`,
      )
      .get(id) as ClientRow;
    recordAudit({
      actorUserId: req.auth?.sub ?? null,
      action: "update",
      entityType: "client",
      entityId: id,
      summary: `Client modifié : ${row.name}`,
    });
    res.json({ client: rowToPublic(row) });
  });

  r.delete("/:id", requireAuth, writeClients, (req: AuthedRequest, res: Response) => {
    const id = typeof req.params.id === "string" ? req.params.id : req.params.id[0];
    const result = hardDeleteClient(id);
    if (!result.ok) {
      if (result.code === "not_found") {
        res.status(404).json({ code: "not_found" });
        return;
      }
      if (result.code === "has_reservations") {
        res.status(409).json({ code: "has_reservations" });
        return;
      }
      res.status(409).json({ code: "has_visitor_ledger" });
      return;
    }
    recordAudit({
      actorUserId: req.auth?.sub ?? null,
      action: "delete",
      entityType: "client",
      entityId: id,
      summary: `Client supprimé (effacement définitif) : ${result.deleted.name} (${result.deleted.email})`,
    });
    res.status(204).end();
  });

  return r;
}
