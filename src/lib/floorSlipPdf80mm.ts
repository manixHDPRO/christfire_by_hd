import type { FloorServiceTabDetail } from "@/types";
import { jsPDF } from "jspdf";

/** Largeur bobine imprimante caisse / POS (standard 80 mm). */
export const FLOOR_SLIP_PAPER_MM = 80;

/**
 * Hauteur minimale du PDF (mm) — correspond à un premier « cran » ticket caisse (~80 × 70 mm),
 * puis le ticket s’allonge automatiquement si l’addition dépasse 70 mm.
 */
const FLOOR_SLIP_MIN_HEIGHT_MM = 70;

/** Recul du dernier glyphe par rapport au bord droit (impression / visionneuses rognent souvent encore). */
const MARGIN_MM = 3.5;
const PRINTABLE_RIGHT_PAD_MM = 3.8;
/** En plus du pad : le texte aligné à droite se termine plus à gauche (évite queue du « D » de USD coupée). */
const AMOUNT_RIGHT_INSET_MM = 2.1;

/** Montant + devise sur une ligne (ex. « 5,00 USD »). */
const FONT_PT_LINE_AMT = 6.15;

const FONT_ARTICLE = ["helvetica", "normal"] as const;
const FONT_META = ["helvetica", "normal"] as const;
const FONT_AMOUNTS = ["helvetica", "normal"] as const;
const FONT_TITLE = ["helvetica", "bold"] as const;
const FONT_SLIP_REF = ["helvetica", "bold"] as const;

const FONT_PT_TITLE = 10;
const FONT_PT_META = 7;
const FONT_PT_LINE_ARTICLE = 7;
const FONT_PT_QTY = 7;

const FONT_PT_TOTAL_MAIN = 10;
const FONT_PT_FOOTER = 6;
const FONT_PT_SLIP_REF = 8.5;

/** Écart après le double trait, avant « Total » (lisibilité). */
const SPACE_AFTER_TOTAL_RULES_MM = 3.55;

/** Espace insécable / fine → espace classique (évite un rendu « lettres espacées » en PDF). */
function sanitizeLocaleNumber(s: string): string {
  return s.replace(/\u202f/g, " ").replace(/\u00a0/g, " ");
}

function fmtPdfPlainInt(n: number): string {
  return sanitizeLocaleNumber(Math.round(n).toLocaleString("fr-FR"));
}

function fmtFc(n: number): string {
  return `${fmtPdfPlainInt(n)} FC`;
}

function fmtUsdAmount(n: number): string {
  return sanitizeLocaleNumber(
    n.toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
  );
}

function cdfToUsd(cdf: number, cdfPerUsd: number): number | null {
  if (!Number.isFinite(cdfPerUsd) || cdfPerUsd <= 0 || !Number.isFinite(cdf)) return null;
  return cdf / cdfPerUsd;
}

/** Logo centré en tête : contraintes (mm). */
const LOGO_MAX_W_MM = 26;
const LOGO_MAX_H_MM = 15;
const LOGO_BOTTOM_GAP_MM = 2;

function lineAdvanceMm(fontPt: number): number {
  return (fontPt / 72) * 25.4 * 1.16;
}

function setFontPdf(doc: jsPDF, pair: readonly [string, string], sizePt: number): void {
  doc.setFont(pair[0], pair[1]);
  doc.setFontSize(sizePt);
}

async function loadBrandingLogoPngDataUrl(): Promise<string | null> {
  if (typeof window === "undefined" || typeof document === "undefined") return null;

  const root = import.meta.env.BASE_URL.endsWith("/") ? import.meta.env.BASE_URL : `${import.meta.env.BASE_URL}/`;
  const svgUrl = new URL("favicon.svg", window.location.origin + root).href;

  try {
    const res = await fetch(svgUrl);
    if (!res.ok) return null;
    const svgText = await res.text();
    const blob = new Blob([svgText], { type: "image/svg+xml;charset=utf-8" });
    const objectUrl = URL.createObjectURL(blob);

    return await new Promise<string | null>((resolve) => {
      const img = new Image();
      img.onload = () => {
        try {
          const wPx = 400;
          const hPx = Math.round((img.naturalHeight / img.naturalWidth) * wPx);
          if (img.naturalWidth <= 0 || img.naturalHeight <= 0) {
            URL.revokeObjectURL(objectUrl);
            resolve(null);
            return;
          }
          const canvas = document.createElement("canvas");
          canvas.width = wPx;
          canvas.height = hPx;
          const ctx = canvas.getContext("2d");
          if (!ctx) {
            URL.revokeObjectURL(objectUrl);
            resolve(null);
            return;
          }
          ctx.fillStyle = "#ffffff";
          ctx.fillRect(0, 0, wPx, hPx);
          ctx.drawImage(img, 0, 0, wPx, hPx);
          const dataUrl = canvas.toDataURL("image/png");
          URL.revokeObjectURL(objectUrl);
          resolve(dataUrl);
        } catch {
          URL.revokeObjectURL(objectUrl);
          resolve(null);
        }
      };
      img.onerror = () => {
        URL.revokeObjectURL(objectUrl);
        resolve(null);
      };
      img.src = objectUrl;
    });
  } catch {
    return null;
  }
}

function logoSizeMm(naturalW: number, naturalH: number): { wMm: number; hMm: number } {
  let wMm = LOGO_MAX_W_MM;
  let hMm = (naturalH / naturalW) * wMm;
  if (hMm > LOGO_MAX_H_MM) {
    hMm = LOGO_MAX_H_MM;
    wMm = (naturalW / naturalH) * hMm;
  }
  return { wMm, hMm };
}

export type FloorSlipPdfPayload = {
  tab: FloorServiceTabDetail;
  pointOfSaleLabel: string;
  serveurName: string;
  cdfPerUsd: number;
};

function measurePdf(): jsPDF {
  return new jsPDF({
    orientation: "p",
    unit: "mm",
    format: [FLOOR_SLIP_PAPER_MM, 1200],
    compress: true,
  });
}

function lineAmtRowHeightMm(): number {
  return Math.max(lineAdvanceMm(FONT_PT_LINE_ARTICLE), lineAdvanceMm(FONT_PT_LINE_AMT));
}

/** Abscisse où se termine le montant aligné à droite (loin du bord rogné). */
function amtRightAnchorXMm(): number {
  return FLOOR_SLIP_PAPER_MM - MARGIN_MM - PRINTABLE_RIGHT_PAD_MM - AMOUNT_RIGHT_INSET_MM;
}

/**
 * Bon cuisine / bar : bobine 80 mm de large ; hauteur minimale 70 mm (caisse POS), puis suivant le contenu.
 * Montants principaux en USD (référence catalogue) ; repli FC si le taux est invalide.
 */
export async function generateFloorAdditionSlipPdf80Mm(payload: FloorSlipPdfPayload): Promise<jsPDF> {
  const cdfPerUsd = payload.cdfPerUsd;
  const showUsd = cdfToUsd(1, cdfPerUsd) != null;
  const slipTotalUsd = cdfToUsd(payload.tab.totalCdf, cdfPerUsd);

  const innerW = FLOOR_SLIP_PAPER_MM - MARGIN_MM * 2;
  const amtTextRightXm = amtRightAnchorXMm();
  const amtColMm = 31;
  const colQtyRight = amtTextRightXm - amtColMm;
  const qtyColMm = 6.5;
  const labelMaxW = Math.max(16.5, colQtyRight - MARGIN_MM - qtyColMm - 1.25);
  const metaBlocks = [
    `Table · ${payload.tab.tableCode} · ${payload.tab.tableLabel}`,
    `Point de vente · ${payload.pointOfSaleLabel}`,
    `Serveur · ${payload.serveurName}`,
    `Émis · ${new Date().toLocaleString("fr-FR")}`,
    showUsd ? "Montants indiqués en USD · référence catalogue." : "Montants en francs congolais.",
  ].filter(Boolean) as string[];
  const footerText =
    "Merci de votre visite chez ChristFire ! Nous mettons tout notre cœur pour vous offrir " +
    "une expérience chaleureuse et savoureuse. Excellente dégustation — à très bientôt !";

  let logoBlockH = 0;
  const logoDataUrl = await loadBrandingLogoPngDataUrl();
  if (logoDataUrl) {
    const tmp = measurePdf();
    const ip = tmp.getImageProperties(logoDataUrl);
    logoBlockH = logoSizeMm(ip.width, ip.height).hMm + LOGO_BOTTOM_GAP_MM;
  }

  const m = measurePdf();
  let yNeeded = MARGIN_MM + logoBlockH;

  setFontPdf(m, FONT_TITLE, FONT_PT_TITLE);
  yNeeded += (m.splitTextToSize("BON BAR / CUISINE", innerW) as string[]).length * lineAdvanceMm(FONT_PT_TITLE) + 0.65;
  const slipFactureTxt = `N° Facture : ${payload.tab.invoiceRef}`;
  setFontPdf(m, FONT_SLIP_REF, FONT_PT_SLIP_REF);
  yNeeded +=
    Math.max(
      (m.splitTextToSize(slipFactureTxt, innerW) as string[]).length * lineAdvanceMm(FONT_PT_SLIP_REF),
      lineAdvanceMm(FONT_PT_SLIP_REF),
    ) + 0.45;

  setFontPdf(m, FONT_META, FONT_PT_META);
  for (const blk of metaBlocks) {
    const lines = m.splitTextToSize(blk, innerW) as string[];
    yNeeded += lines.length * lineAdvanceMm(FONT_PT_META) + 0.35;
  }

  yNeeded += 1.2 + 2.2;

  setFontPdf(m, FONT_ARTICLE, FONT_PT_LINE_ARTICLE);
  const amtH = lineAmtRowHeightMm();
  for (const ln of payload.tab.lines) {
    const labelLines = m.splitTextToSize(ln.label, labelMaxW) as string[];
    const lh = Math.max(labelLines.length, 1) * lineAdvanceMm(FONT_PT_LINE_ARTICLE);
    yNeeded += Math.max(lh, amtH) + 0.35;
  }

  yNeeded += 0.35 + 0.35 + 0.72 + SPACE_AFTER_TOTAL_RULES_MM;

  setFontPdf(m, FONT_TITLE, FONT_PT_TOTAL_MAIN);
  yNeeded += lineAdvanceMm(FONT_PT_TOTAL_MAIN);
  if (slipTotalUsd != null) {
    setFontPdf(m, FONT_META, FONT_PT_META);
    yNeeded += 0.3 + lineAdvanceMm(FONT_PT_META);
  }
  yNeeded += 2.35;

  setFontPdf(m, FONT_META, FONT_PT_FOOTER);
  yNeeded += ((m.splitTextToSize(footerText, innerW) as string[]).length + 0.35) * lineAdvanceMm(FONT_PT_FOOTER);
  yNeeded += MARGIN_MM + 2;

  const pageH = Math.min(Math.ceil(yNeeded), 900);

  const doc = new jsPDF({
    orientation: "p",
    unit: "mm",
    format: [FLOOR_SLIP_PAPER_MM, Math.max(pageH, FLOOR_SLIP_MIN_HEIGHT_MM)],
    compress: true,
  });

  doc.setFillColor(255, 255, 255);
  doc.rect(0, 0, FLOOR_SLIP_PAPER_MM, doc.internal.pageSize.getHeight(), "F");

  let y = MARGIN_MM;

  if (logoDataUrl) {
    try {
      const ip = doc.getImageProperties(logoDataUrl);
      const { wMm, hMm } = logoSizeMm(ip.width, ip.height);
      doc.addImage(logoDataUrl, "PNG", (FLOOR_SLIP_PAPER_MM - wMm) / 2, y, wMm, hMm);
      y += hMm + LOGO_BOTTOM_GAP_MM;
    } catch {
      /* bon sans logo si addImage échoue */
    }
  }

  doc.setTextColor(26, 26, 26);
  setFontPdf(doc, FONT_TITLE, FONT_PT_TITLE);
  const titleLines = doc.splitTextToSize("BON BAR / CUISINE", innerW) as string[];
  for (const line of titleLines) {
    doc.text(line, FLOOR_SLIP_PAPER_MM / 2, y, { align: "center" });
    y += lineAdvanceMm(FONT_PT_TITLE);
  }
  y += 0.45;

  setFontPdf(doc, FONT_SLIP_REF, FONT_PT_SLIP_REF);
  doc.setTextColor(45, 45, 45);
  const slipRefLines = doc.splitTextToSize(`N° Facture : ${payload.tab.invoiceRef}`, innerW) as string[];
  for (const line of slipRefLines) {
    doc.text(line, FLOOR_SLIP_PAPER_MM / 2, y, { align: "center" });
    y += lineAdvanceMm(FONT_PT_SLIP_REF);
  }
  y += 0.45;

  setFontPdf(doc, FONT_META, FONT_PT_META);
  doc.setTextColor(26, 26, 26);
  for (const blk of metaBlocks) {
    for (const line of doc.splitTextToSize(blk, innerW) as string[]) {
      doc.text(line, MARGIN_MM, y);
      y += lineAdvanceMm(FONT_PT_META);
    }
    y += 0.25;
  }
  y += 0.55;

  doc.setDrawColor(55, 55, 55);
  doc.setLineWidth(0.28);
  doc.line(MARGIN_MM, y, FLOOR_SLIP_PAPER_MM - MARGIN_MM, y);
  y += 2.4;

  for (const ln of payload.tab.lines) {
    const yRow = y;
    setFontPdf(doc, FONT_ARTICLE, FONT_PT_LINE_ARTICLE);
    doc.setTextColor(38, 38, 38);
    const labelLines = doc.splitTextToSize(ln.label, labelMaxW) as string[];
    doc.text(labelLines[0] ?? "", MARGIN_MM, yRow);

    const qtyStr = Number.isInteger(ln.qty)
      ? String(ln.qty)
      : sanitizeLocaleNumber(ln.qty.toLocaleString("fr-FR", { maximumFractionDigits: 2 }));
    setFontPdf(doc, FONT_AMOUNTS, FONT_PT_QTY);
    doc.text(qtyStr, colQtyRight, yRow, { align: "right" });

    const usdLn = cdfToUsd(ln.lineTotalCdf, cdfPerUsd);
    const amtStr = usdLn != null ? `${fmtUsdAmount(usdLn)} USD` : fmtFc(ln.lineTotalCdf);
    setFontPdf(doc, FONT_AMOUNTS, FONT_PT_LINE_AMT);
    doc.text(amtStr, amtTextRightXm, yRow, { align: "right" });

    let ty = yRow + lineAdvanceMm(FONT_PT_LINE_ARTICLE);
    for (let i = 1; i < labelLines.length; i++) {
      setFontPdf(doc, FONT_ARTICLE, FONT_PT_LINE_ARTICLE);
      doc.setTextColor(38, 38, 38);
      doc.text(labelLines[i]!, MARGIN_MM, ty);
      ty += lineAdvanceMm(FONT_PT_LINE_ARTICLE);
    }

    const rowBottom = Math.max(ty, yRow + lineAmtRowHeightMm());
    y = rowBottom + 0.35;
    setFontPdf(doc, FONT_ARTICLE, FONT_PT_LINE_ARTICLE);
  }

  y += 0.35;
  doc.setDrawColor(55, 55, 55);
  doc.setLineWidth(0.3);
  doc.line(MARGIN_MM, y, FLOOR_SLIP_PAPER_MM - MARGIN_MM, y);
  y += 0.72;
  doc.setLineWidth(0.26);
  doc.line(MARGIN_MM, y, FLOOR_SLIP_PAPER_MM - MARGIN_MM, y);
  y += SPACE_AFTER_TOTAL_RULES_MM;

  doc.setTextColor(18, 18, 18);
  if (slipTotalUsd != null) {
    setFontPdf(doc, FONT_TITLE, FONT_PT_TOTAL_MAIN);
    doc.text(`Total ${fmtUsdAmount(slipTotalUsd)} USD`, MARGIN_MM, y);
    y += lineAdvanceMm(FONT_PT_TOTAL_MAIN) + 0.3;
    setFontPdf(doc, FONT_META, FONT_PT_META);
    doc.setTextColor(55, 55, 55);
    doc.text(`Soit ${fmtFc(payload.tab.totalCdf)}`, MARGIN_MM, y);
    y += lineAdvanceMm(FONT_PT_META) + 1.05;
  } else {
    setFontPdf(doc, FONT_TITLE, FONT_PT_TOTAL_MAIN);
    doc.text(`Total ${fmtFc(payload.tab.totalCdf)}`, MARGIN_MM, y);
    y += lineAdvanceMm(FONT_PT_TOTAL_MAIN) + 1.05;
  }

  doc.setTextColor(100, 100, 100);
  setFontPdf(doc, FONT_META, FONT_PT_FOOTER);
  for (const fl of doc.splitTextToSize(footerText, innerW) as string[]) {
    doc.text(fl, MARGIN_MM, y);
    y += lineAdvanceMm(FONT_PT_FOOTER);
  }

  return doc;
}
