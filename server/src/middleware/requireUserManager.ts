import { authFlagsForRoleLabel } from "../appUserRoles.js";
import type { NextFunction, Response } from "express";
import type { AuthedRequest } from "./requireAuth.js";

/** Création / modification / suppression de comptes applicatifs (hors simple lecture liste). */
export function requireUserManager(req: AuthedRequest, res: Response, next: NextFunction): void {
  const role = req.auth?.role;
  if (!role || !authFlagsForRoleLabel(role).canManageAppUsers) {
    res.status(403).json({ code: "forbidden" });
    return;
  }
  next();
}
