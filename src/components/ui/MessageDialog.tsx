import { useEffect, useRef } from "react";

export type MessageDialogVariant = "info" | "success" | "error" | "warning";

const DEFAULT_TITLE: Record<MessageDialogVariant, string> = {
  info: "Information",
  success: "Succès",
  error: "Erreur",
  warning: "Attention",
};

const VARIANT_BORDER: Record<MessageDialogVariant, string> = {
  info: "border-brand-orange/35",
  success: "border-emerald-500/40",
  error: "border-rose-500/40",
  warning: "border-amber-500/40",
};

type Props = {
  open: boolean;
  title?: string;
  message: string;
  variant?: MessageDialogVariant;
  onClose: () => void;
  confirmLabel?: string;
};

export function MessageDialog({
  open,
  title,
  message,
  variant = "info",
  onClose,
  confirmLabel = "OK",
}: Props) {
  const confirmRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    queueMicrotask(() => confirmRef.current?.focus());
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  const displayTitle = title ?? DEFAULT_TITLE[variant];

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center p-4">
      <button
        type="button"
        className="absolute inset-0 bg-black/65 backdrop-blur-[2px]"
        aria-label="Fermer"
        onClick={onClose}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="message-dialog-title"
        className={`relative z-[1] w-full max-w-md rounded-2xl border bg-[#1a1210] p-5 shadow-xl ${VARIANT_BORDER[variant]}`}
      >
        <h2 id="message-dialog-title" className="font-display text-lg text-brand-cream/95">
          {displayTitle}
        </h2>
        <p className="mt-3 whitespace-pre-wrap text-sm leading-relaxed text-white/80">{message}</p>
        <div className="mt-6 flex justify-end">
          <button
            ref={confirmRef}
            type="button"
            onClick={onClose}
            className="rounded-xl bg-gradient-to-r from-brand-red to-brand-red-orange px-5 py-2.5 text-sm font-semibold text-white shadow-glow-sm hover:opacity-95"
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
