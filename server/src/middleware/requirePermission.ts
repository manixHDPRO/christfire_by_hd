import type { NextFunction, Response } from "express";
import { roleHasAnyPermission } from "../permissions.js";
import type { AuthedRequest } from "./requireAuth.js";

/** Au moins un des codes requis (OU logique). */
export function requireAnyPermission(...codes: string[]) {
  return (req: AuthedRequest, res: Response, next: NextFunction): void => {
    const role = req.auth?.role;
    if (!role) {
      res.status(401).json({ code: "unauthorized" });
      return;
    }
    if (!roleHasAnyPermission(role, codes)) {
      res.status(403).json({ code: "forbidden" });
      return;
    }
    next();
  };
}
