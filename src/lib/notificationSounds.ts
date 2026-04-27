/**
 * Brefs signaux sonores (Web Audio API) — utiles sans fichier audio externe.
 * Nécessite un geste utilisateur sur certains navigateurs ; les boutons d’action suffisent.
 */

let sharedCtx: AudioContext | null = null;

function ctx(): AudioContext | null {
  if (typeof window === "undefined") return null;
  try {
    if (!sharedCtx) {
      const AC =
        window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AC) return null;
      sharedCtx = new AC();
    }
    if (sharedCtx.state === "suspended") {
      void sharedCtx.resume();
    }
    return sharedCtx;
  } catch {
    return null;
  }
}

function beep(
  c: AudioContext,
  startTime: number,
  frequencyHz: number,
  durationSec: number,
  gain: number,
): void {
  const osc = c.createOscillator();
  const g = c.createGain();
  osc.type = "sine";
  osc.frequency.setValueAtTime(frequencyHz, startTime);
  g.gain.setValueAtTime(0, startTime);
  g.gain.linearRampToValueAtTime(gain, startTime + 0.02);
  g.gain.exponentialRampToValueAtTime(0.001, startTime + durationSec);
  osc.connect(g);
  g.connect(c.destination);
  osc.start(startTime);
  osc.stop(startTime + durationSec + 0.02);
}

/** Son court « envoi / nouveau dossier » (deux tons montants). */
export function playPurchaseOrderSubmittedChime(): void {
  const c = ctx();
  if (!c) return;
  const t = c.currentTime;
  beep(c, t, 587.33, 0.11, 0.09);
  beep(c, t + 0.1, 783.99, 0.12, 0.085);
}

/** Son de validation (arpège léger, ton positif). */
export function playPurchaseOrderApprovalChime(): void {
  const c = ctx();
  if (!c) return;
  const t = c.currentTime;
  const freqs = [523.25, 659.25, 783.99];
  freqs.forEach((f, i) => beep(c, t + i * 0.09, f, 0.14, 0.08));
}

/** Appelé côté soumission (évite de rejouer le « nouveau BC » via le poll Dashboard). */
export function suppressRemotePurchaseOrderSubmitSoundForMs(ms: number): void {
  try {
    sessionStorage.setItem("cf:po:suppressRemoteSubmitSoundUntil", String(Date.now() + ms));
  } catch {
    /* ignore */
  }
}

export function shouldPlayRemoteSubmitSound(): boolean {
  try {
    const until = Number(sessionStorage.getItem("cf:po:suppressRemoteSubmitSoundUntil") || 0);
    return !Number.isFinite(until) || Date.now() > until;
  } catch {
    return true;
  }
}
