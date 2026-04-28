/**
 * Supprime toutes les réservations et les lignes du journal de paiement associées,
 * puis resynchronise les statuts des bungalows (Disponible / Réservé / Occupé).
 * Usage : npx tsx scripts/clear-reservations.ts (depuis server/)
 *
 * Ne remettez pas `SEED_DEMO_RESERVATIONS=1` dans .env si vous voulez garder la table vide :
 * sans cette variable, le serveur ne réinjecte plus les 4 réservations de démo au démarrage.
 */
import { db } from "../src/db.js";
import { syncBungalowStatusForDb } from "../src/syncBungalowStatus.js";

const pay = db.prepare("DELETE FROM reservation_payments").run();
const res = db.prepare("DELETE FROM reservations").run();
const bungalows = db.prepare("SELECT id FROM bungalows").all() as { id: string }[];
for (const b of bungalows) {
  syncBungalowStatusForDb(b.id);
}
console.log(
  `[clear-reservations] ${res.changes} réservation(s), ${pay.changes} ligne(s) de paiement supprimée(s). ${bungalows.length} bungalow(s) resynchronisé(s).`,
);
