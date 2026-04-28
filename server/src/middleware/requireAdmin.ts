import { authFlagsForRoleLabel } from "../appUserRoles.js";
import type { NextFunction, Response } from "express";
import type { AuthedRequest } from "./requireAuth.js";

export function requireAdmin(req: AuthedRequest, res: Response, next: NextFunction): void {
  const role = req.auth?.role;
  if (!role || !authFlagsForRoleLabel(role).isAppAdmin) {
    res.status(403).json({ code: "forbidden" });
    return;
  }
  next();
}
