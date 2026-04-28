import { db } from "./db.js";

export function markBungalowsHousekeepingDirty(bungalowIds: string[]): void {
  const upd = db.prepare(`UPDATE bungalows SET housekeeping_status = 'À nettoyer' WHERE id = ?`);
  for (const id of bungalowIds) {
    upd.run(id);
  }
}
