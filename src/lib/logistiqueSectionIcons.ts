import type { LucideIcon } from "lucide-react";
import {
  ArrowLeftRight,
  Building2,
  FileText,
  Gauge,
  History,
  LayoutDashboard,
  ListOrdered,
  Package,
  PackageCheck,
  ScanLine,
} from "lucide-react";

import type { LogistiqueSectionId } from "./logistiqueNavBuckets";

const LOGISTIQUE_SECTION_ICONS: Record<LogistiqueSectionId, LucideIcon> = {
  vue: LayoutDashboard,
  articles: Package,
  seuils: Gauge,
  "a-commander": ListOrdered,
  fournisseurs: Building2,
  commandes: FileText,
  reception: PackageCheck,
  transfert: ArrowLeftRight,
  inventaire: ScanLine,
  historique: History,
};

export function logistiqueSectionLucideIcon(section: LogistiqueSectionId): LucideIcon {
  return LOGISTIQUE_SECTION_ICONS[section];
}
