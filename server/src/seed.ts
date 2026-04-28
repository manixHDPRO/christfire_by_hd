import bcrypt from "bcryptjs";
import { db } from "./db.js";
import type { UserRole } from "./types.js";

const BCRYPT_ROUNDS = 12;

type SeedRow = {
  id: string;
  email: string;
  password: string;
  name: string;
  role: UserRole;
  active: boolean;
};

/** Aligné sur l’ancien mock + mots de passe à changer après 1er déploiement. */
const SEED_USERS: SeedRow[] = [
  {
    id: "u1",
    email: "admin@christfire.hd",
    password: "ChristFire2026",
    name: "Admin ChristFire",
    role: "Administrateur",
    active: true,
  },
  {
    id: "u2",
    email: "reception@hd-christfire.hd",
    password: "Reception2026",
    name: "Léa Dubois",
    role: "Réception",
    active: true,
  },
  {
    id: "u3",
    email: "direction@hd-christfire.hd",
    password: "Commercial2026",
    name: "Marc Petit",
    role: "Commercial",
    active: true,
  },
  {
    id: "u4",
    email: "compta@christfire.hd",
    password: "Compta2026",
    name: "Claire Morel",
    role: "Comptabilité",
    active: false,
  },
];

export function seedUsersIfEmpty(): void {
  const row = db.prepare("SELECT COUNT(*) AS c FROM users").get() as { c: number };
  if (row.c > 0) return;

  const insert = db.prepare(`
    INSERT INTO users (id, email, password_hash, name, role, active, created_at, updated_at)
    VALUES (@id, @email, @password_hash, @name, @role, @active, datetime('now'), datetime('now'))
  `);

  const run = db.transaction(() => {
    for (const u of SEED_USERS) {
      const password_hash = bcrypt.hashSync(u.password, BCRYPT_ROUNDS);
      insert.run({
        id: u.id,
        email: u.email.toLowerCase(),
        password_hash,
        name: u.name,
        role: u.role,
        active: u.active ? 1 : 0,
      });
    }
  });

  run();
  console.info("[hd-christfire] Base SQLite initialisée : utilisateurs de seed créés.");
}

/** Anciens domaines `.example` → `.hd` (BDD créée avant le renommage). */
const LEGACY_EMAIL_RENAMES: [string, string][] = [
  ["admin@christfire.example", "admin@christfire.hd"],
  ["reception@hd-christfire.example", "reception@hd-christfire.hd"],
  ["direction@hd-christfire.example", "direction@hd-christfire.hd"],
  ["compta@christfire.example", "compta@christfire.hd"],
];

export function migrateLegacyUserEmails(): void {
  const stmt = db.prepare(
    "UPDATE users SET email = @newEmail WHERE lower(email) = lower(@oldEmail)",
  );
  let total = 0;
  for (const [oldEmail, newEmail] of LEGACY_EMAIL_RENAMES) {
    const r = stmt.run({ oldEmail, newEmail: newEmail.toLowerCase() });
    total += r.changes;
  }
  if (total > 0) {
    console.info(`[hd-christfire] ${total} compte(s) : e-mail .example → .hd (alignement seed).`);
  }
}

/** Même jeu que le mock front (ids c1–c3) pour garder les réservations démo cohérentes. */
const SEED_CLIENTS: { id: string; name: string; email: string; phone: string; notes: string }[] = [
  {
    id: "c1",
    name: "Marie Laurent",
    email: "marie.l@email.fr",
    phone: "+33 6 12 34 56 78",
    notes: "Préfère bungalow calme, étage si disponible.",
  },
  {
    id: "c2",
    name: "Thomas Bernard",
    email: "t.bernard@pro.fr",
    phone: "+33 6 98 76 54 32",
    notes: "Facturation société — SIRET sur fichier.",
  },
  {
    id: "c3",
    name: "Sophie Martin",
    email: "sophie.m@gmail.com",
    phone: "+33 7 11 22 33 44",
    notes: "",
  },
];

export function seedClientsIfEmpty(): void {
  const row = db.prepare("SELECT COUNT(*) AS c FROM clients").get() as { c: number };
  if (row.c > 0) return;

  const insert = db.prepare(`
    INSERT INTO clients (id, name, email, phone, notes, client_profile)
    VALUES (@id, @name, @email, @phone, @notes, 'hebergement')
  `);

  const run = db.transaction(() => {
    for (const c of SEED_CLIENTS) {
      insert.run({
        id: c.id,
        name: c.name,
        email: c.email.toLowerCase(),
        phone: c.phone,
        notes: c.notes,
      });
    }
  });

  run();
  console.info("[hd-christfire] Clients de démonstration insérés (table vide).");
}

/** Aligné sur le mock front (ids b1–b6) pour cohérence avec les réservations démo. */
const SEED_BUNGALOWS: {
  id: string;
  code: string;
  label: string;
  category: string;
  /** Tarif / nuit au bungalow (prioritaire sur la grille catégorie) ; absent = grille uniquement. */
  pricePerNightUsd?: number | null;
  rooms: number;
  capacity: number;
  description: string;
  image: string;
  amenities: string[];
  status: string;
}[] = [
  {
    id: "b1",
    code: "B-P-01",
    label: "Lodge Émbers",
    category: "Premium",
    rooms: 2,
    capacity: 3,
    description: "Vue panoramique, terrasse privative et finitions haut de gamme.",
    image: "https://images.unsplash.com/photo-1582719478250-c89cae4dc85b?w=800&q=80",
    amenities: ["Wi‑Fi", "Climatisation", "Kitchenette", "Jacuzzi"],
    status: "Disponible",
  },
  {
    id: "b2",
    code: "B-D-04",
    label: "Cabane Solaire",
    category: "Deluxe",
    pricePerNightUsd: 250,
    rooms: 2,
    capacity: 2,
    description: "Lumière naturelle, espace salon et literie premium.",
    image: "https://images.unsplash.com/photo-1566073771259-6a8506099945?w=800&q=80",
    amenities: ["Wi‑Fi", "Climatisation", "Kitchenette"],
    status: "Disponible",
  },
  {
    id: "b3",
    code: "B-S-07",
    label: "Nid Calme",
    category: "Standard",
    rooms: 1,
    capacity: 2,
    description: "Compact, fonctionnel, idéal séjours courts.",
    image: "https://images.unsplash.com/photo-1520250497591-112f2f40a3f4?w=800&q=80",
    amenities: ["Wi‑Fi", "Ventilateur"],
    status: "Maintenance",
  },
  {
    id: "b4",
    code: "B-P-12",
    label: "Suite Braisée",
    category: "Premium",
    rooms: 2,
    capacity: 3,
    description: "Grande salle de bain, dressing et accès jardin.",
    image: "https://images.unsplash.com/photo-1618773928121-c32242e63f39?w=800&q=80",
    amenities: ["Wi‑Fi", "Climatisation", "Kitchenette", "Bar"],
    status: "Disponible",
  },
  {
    id: "b5",
    code: "B-D-09",
    label: "Refuge Cuivré",
    category: "Deluxe",
    rooms: 1,
    capacity: 2,
    description: "Ambiance chaleureuse, bureau intégré.",
    image: "https://images.unsplash.com/photo-1596394516093-501ba68a0ba6?w=800&q=80",
    amenities: ["Wi‑Fi", "Climatisation"],
    status: "Disponible",
  },
  {
    id: "b6",
    code: "B-S-02",
    label: "Studio Braise",
    category: "Standard",
    rooms: 1,
    capacity: 1,
    description: "Solo ou télétravail, tout équipé.",
    image: "https://images.unsplash.com/photo-1631049307264-da0ec9d70304?w=800&q=80",
    amenities: ["Wi‑Fi", "Kitchenette"],
    status: "Hors service",
  },
];

export function seedBungalowsIfEmpty(): void {
  const row = db.prepare("SELECT COUNT(*) AS c FROM bungalows").get() as { c: number };
  if (row.c > 0) return;

  const insert = db.prepare(`
    INSERT INTO bungalows (id, code, label, category, price_per_night_usd, rooms, capacity, description, image, amenities_json, status)
    VALUES (@id, @code, @label, @category, @price_per_night_usd, @rooms, @capacity, @description, @image, @amenities_json, @status)
  `);

  const run = db.transaction(() => {
    for (const b of SEED_BUNGALOWS) {
      insert.run({
        id: b.id,
        code: b.code,
        label: b.label,
        category: b.category,
        price_per_night_usd: b.pricePerNightUsd ?? null,
        rooms: b.rooms,
        capacity: b.capacity,
        description: b.description,
        image: b.image,
        amenities_json: JSON.stringify(b.amenities),
        status: b.status,
      });
    }
  });

  run();
  console.info("[hd-christfire] Bungalows de démonstration insérés (table vide).");
}

/** Même jeu que le mock front — inséré seulement si client + bungalows existent (FK). */
const SEED_RESERVATIONS: {
  id: string;
  clientId: string;
  bungalowIds: string[];
  reservationKind: "individual" | "group";
  start: string;
  end: string;
  status: string;
  amount: number;
  amountPaid: number;
  /** Renseigné pour les réservations groupe (≥ 2 personnes). */
  guestCount?: number;
}[] = [
  {
    id: "r1",
    clientId: "c1",
    bungalowIds: ["b1"],
    reservationKind: "individual",
    start: "2026-04-08",
    end: "2026-04-12",
    status: "Confirmé",
    amount: 1840,
    amountPaid: 1840,
  },
  {
    id: "r2",
    clientId: "c2",
    bungalowIds: ["b2"],
    reservationKind: "individual",
    start: "2026-04-06",
    end: "2026-04-09",
    status: "En cours",
    amount: 750,
    amountPaid: 750,
  },
  {
    id: "r3",
    clientId: "c3",
    bungalowIds: ["b4"],
    reservationKind: "individual",
    start: "2026-04-15",
    end: "2026-04-18",
    status: "Confirmé",
    amount: 1320,
    amountPaid: 1320,
  },
  {
    id: "r4",
    clientId: "c1",
    bungalowIds: ["b5"],
    reservationKind: "individual",
    start: "2026-04-20",
    end: "2026-04-22",
    status: "Confirmé",
    amount: 410,
    amountPaid: 410,
  },
  {
    id: "r5",
    clientId: "c2",
    bungalowIds: ["b4", "b5"],
    reservationKind: "group",
    start: "2026-05-01",
    end: "2026-05-05",
    status: "En attente paiement",
    amount: 1600,
    amountPaid: 0,
    guestCount: 6,
  },
];

export function seedReservationsIfEmpty(): void {
  const row = db.prepare("SELECT COUNT(*) AS c FROM reservations").get() as { c: number };
  if (row.c > 0) return;

  const insert = db.prepare(`
    INSERT INTO reservations (id, client_id, bungalow_id, start_date, end_date, status, amount, amount_paid, guest_count, reservation_kind)
    VALUES (@id, @client_id, @bungalow_id, @start_date, @end_date, @status, @amount, @amount_paid, @guest_count, @reservation_kind)
  `);
  const insertRb = db.prepare(`
    INSERT INTO reservation_bungalows (reservation_id, bungalow_id, sort_order)
    VALUES (@reservation_id, @bungalow_id, @sort_order)
  `);

  const clientExists = db.prepare("SELECT 1 AS x FROM clients WHERE id = ?");
  const bungalowExists = db.prepare("SELECT 1 AS x FROM bungalows WHERE id = ?");

  let inserted = 0;
  const run = db.transaction(() => {
    for (const res of SEED_RESERVATIONS) {
      if (!clientExists.get(res.clientId)) continue;
      const primary = res.bungalowIds[0];
      if (!primary || !res.bungalowIds.every((id) => Boolean(bungalowExists.get(id)))) continue;
      const guestCount =
        res.reservationKind === "group"
          ? Math.max(2, Math.min(99, Math.floor(res.guestCount ?? 2)))
          : 1;
      insert.run({
        id: res.id,
        client_id: res.clientId,
        bungalow_id: primary,
        start_date: res.start,
        end_date: res.end,
        status: res.status,
        amount: res.amount,
        amount_paid: res.amountPaid,
        guest_count: guestCount,
        reservation_kind: res.reservationKind,
      });
      res.bungalowIds.forEach((bungalow_id, sort_order) => {
        insertRb.run({ reservation_id: res.id, bungalow_id, sort_order });
      });
      inserted += 1;
    }
  });

  try {
    run();
  } catch (e) {
    console.error("[hd-christfire] seed réservations:", e);
    throw e;
  }
  if (inserted > 0) {
    console.info(`[hd-christfire] ${inserted} réservation(s) de démonstration insérées (table vide).`);
  }
}

/** Taux CDF/USD et tarification par catégorie (une ligne fixe + 3 catégories). */
export function seedExchangeRateAndCategoryRatesIfEmpty(): void {
  const ex = db.prepare("SELECT 1 AS x FROM app_exchange_rate WHERE id = 1").get() as { x: number } | undefined;
  if (!ex) {
    db.prepare("INSERT INTO app_exchange_rate (id, cdf_per_usd) VALUES (1, 2850)").run();
    console.info("[hd-christfire] Taux de change par défaut : 2850 CDF / USD.");
  }
  db.prepare(
    "INSERT OR IGNORE INTO app_visitor_entry (id, price_usd, adult_price_usd, minor_price_usd) VALUES (1, 10, 10, 5)",
  ).run();
  const ins = db.prepare(
    "INSERT OR IGNORE INTO category_rates (category, price_per_night_usd) VALUES (@category, @price)",
  );
  for (const row of [
    { category: "Premium", price: 240 },
    { category: "Deluxe", price: 155 },
    { category: "Standard", price: 95 },
  ] as const) {
    ins.run({ category: row.category, price: row.price });
  }

  const catIns = db.prepare(
    "INSERT OR IGNORE INTO bungalow_categories (key, label) VALUES (@key, @label)",
  );
  for (const row of [
    { key: "Premium", label: "Premium" },
    { key: "Deluxe", label: "Deluxe" },
    { key: "Standard", label: "Standard" },
  ] as const) {
    catIns.run(row);
  }
}
