import nodemailer from "nodemailer";

export type SendInvitationMailInput = {
  to: string;
  inviteeName: string;
  inviteUrl: string;
  expiresAtLabel: string;
  roleLabel: string;
};

function smtpConfigured(): boolean {
  return Boolean(process.env.SMTP_HOST?.trim() && process.env.MAIL_FROM?.trim());
}

export function isInvitationMailConfigured(): boolean {
  return smtpConfigured();
}

export async function sendInvitationMail(
  input: SendInvitationMailInput,
): Promise<{ ok: true } | { ok: false; code: "not_configured" | "send_failed"; detail?: string }> {
  const host = process.env.SMTP_HOST?.trim();
  const from = process.env.MAIL_FROM?.trim();
  if (!host || !from) {
    return { ok: false, code: "not_configured" };
  }

  const port = Number(process.env.SMTP_PORT ?? "587");
  const secure = process.env.SMTP_SECURE === "1" || String(port) === "465";
  const user = process.env.SMTP_USER?.trim();
  const pass = process.env.SMTP_PASS ?? "";

  const transporter = nodemailer.createTransport({
    host,
    port,
    secure,
    auth: user ? { user, pass } : undefined,
  });

  const subject = "Invitation — accès HD by ChristFire";
  const text = [
    `Bonjour ${input.inviteeName},`,
    "",
    "Vous avez été invité·e à rejoindre l’application HD by ChristFire.",
    `Rôle attribué : ${input.roleLabel}.`,
    "",
    "Pour activer votre compte et choisir votre mot de passe, ouvrez le lien ci-dessous :",
    input.inviteUrl,
    "",
    `Ce lien expire le ${input.expiresAtLabel}.`,
    "",
    "Si vous n’attendiez pas cet e-mail, vous pouvez l’ignorer.",
    "",
    "— HD by ChristFire",
  ].join("\n");

  const html = `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="font-family:system-ui,sans-serif;line-height:1.5;color:#1c1917;max-width:36rem">
  <p>Bonjour ${escapeHtml(input.inviteeName)},</p>
  <p>Vous avez été invité·e à rejoindre l’application <strong>HD by ChristFire</strong>.</p>
  <p>Rôle attribué : <strong>${escapeHtml(input.roleLabel)}</strong>.</p>
  <p>Pour activer votre compte et choisir votre mot de passe :</p>
  <p><a href="${escapeAttr(input.inviteUrl)}">${escapeHtml(input.inviteUrl)}</a></p>
  <p style="color:#57534e;font-size:0.9rem">Ce lien expire le ${escapeHtml(input.expiresAtLabel)}.</p>
  <p style="color:#78716c;font-size:0.85rem">Si vous n’attendiez pas cet e-mail, vous pouvez l’ignorer.</p>
  <p>— HD by ChristFire</p>
</body>
</html>`;

  try {
    await transporter.sendMail({
      from,
      to: input.to,
      subject,
      text,
      html,
    });
    return { ok: true };
  } catch (e) {
    const detail = e instanceof Error ? e.message : undefined;
    return { ok: false, code: "send_failed", detail };
  }
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function escapeAttr(s: string): string {
  return escapeHtml(s).replace(/'/g, "&#39;");
}
