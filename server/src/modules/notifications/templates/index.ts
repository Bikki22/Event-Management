import { UnrecoverableError } from "bullmq";
import { env } from "../../../config/env.js";

export interface RenderedEmail {
  subject: string;
  html: string;
  text: string;
}

/** Every email type and the payload it needs. Payloads are stored in `notifications.payload`. */
export interface EmailPayloads {
  "auth.verify_email": { name: string; token: string | null };
  "auth.password_reset": { name: string; token: string | null };
  "auth.password_changed": { name: string; changedAt: string };
  "organizer.verified": { name: string; orgName: string };
  "organizer.rejected": { name: string; orgName: string; note: string };
}
export type EmailType = keyof EmailPayloads;

/** Payload keys holding one-time secrets; scrubbed from the DB once the email is sent. */
export const SECRET_PAYLOAD_KEYS = ["token"] as const;

const escapeHtml = (s: string) =>
  s.replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!,
  );

function layout(opts: {
  preheader: string;
  greeting: string;
  paragraphs: string[];
  button?: { label: string; url: string };
  footer: string;
}): { html: string; text: string } {
  const app = escapeHtml(env.APP_NAME);
  const paras = opts.paragraphs
    .map((p) => `<p style="margin:0 0 16px;line-height:1.5">${escapeHtml(p)}</p>`)
    .join("");
  const button = opts.button
    ? `<p style="margin:24px 0"><a href="${escapeHtml(opts.button.url)}" style="background:#4f46e5;color:#fff;padding:12px 20px;border-radius:6px;text-decoration:none;display:inline-block">${escapeHtml(opts.button.label)}</a></p>
       <p style="margin:0 0 16px;font-size:13px;color:#555">Or paste this link into your browser:<br><span style="word-break:break-all">${escapeHtml(opts.button.url)}</span></p>`
    : "";
  const html = `<!doctype html><html><body style="margin:0;background:#f4f4f5;font-family:Arial,Helvetica,sans-serif;color:#111">
<span style="display:none">${escapeHtml(opts.preheader)}</span>
<table width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:32px 16px">
<table width="100%" style="max-width:560px;background:#fff;border-radius:8px;padding:32px" cellpadding="0" cellspacing="0"><tr><td>
<h2 style="margin:0 0 24px">${app}</h2>
<p style="margin:0 0 16px">${escapeHtml(opts.greeting)}</p>${paras}${button}
<p style="margin:24px 0 0;font-size:12px;color:#777">${escapeHtml(opts.footer)}</p>
</td></tr></table></td></tr></table></body></html>`;

  const text = [
    opts.greeting,
    "",
    ...opts.paragraphs.flatMap((p) => [p, ""]),
    ...(opts.button ? [`${opts.button.label}: ${opts.button.url}`, ""] : []),
    opts.footer,
  ].join("\n");
  return { html, text };
}

const link = (path: string, token: string | null) => {
  if (!token) throw new UnrecoverableError("token already scrubbed; email was sent before");
  const url = new URL(path, env.FRONTEND_URL);
  url.searchParams.set("token", token);
  return url.toString();
};

const renderers: { [K in EmailType]: (p: EmailPayloads[K]) => RenderedEmail } = {
  "auth.verify_email": (p) => ({
    subject: `Verify your email for ${env.APP_NAME}`,
    ...layout({
      preheader: "Confirm your email address to finish setting up your account.",
      greeting: `Hi ${p.name},`,
      paragraphs: [
        "Thanks for signing up. Please confirm your email address so you can book tickets and manage events.",
        `This link expires in ${env.EMAIL_VERIFY_TTL_HOURS} hours and can be used once.`,
      ],
      button: { label: "Verify email", url: link("/verify-email", p.token) },
      footer: "If you didn't create an account, you can ignore this email.",
    }),
  }),
  "auth.password_reset": (p) => ({
    subject: `Reset your ${env.APP_NAME} password`,
    ...layout({
      preheader: "Use this link to choose a new password.",
      greeting: `Hi ${p.name},`,
      paragraphs: [
        "We received a request to reset your password.",
        `This link expires in ${env.PASSWORD_RESET_TTL_MINUTES} minutes and can be used once. Resetting signs you out on all devices.`,
      ],
      button: { label: "Reset password", url: link("/reset-password", p.token) },
      footer: "If you didn't ask for this, ignore this email. Your password won't change.",
    }),
  }),
  "auth.password_changed": (p) => ({
    subject: `Your ${env.APP_NAME} password was changed`,
    ...layout({
      preheader: "Your password was just changed.",
      greeting: `Hi ${p.name},`,
      paragraphs: [
        `Your password was changed on ${new Date(p.changedAt).toUTCString()}.`,
        'If this was you, no action is needed. If it wasn\'t, reset your password right away using "Forgot password" on the sign-in page.',
      ],
      footer: "This is a security notification for your account.",
    }),
  }),
  "organizer.verified": (p) => ({
    subject: `${p.orgName} is verified on ${env.APP_NAME}`,
    ...layout({
      preheader: "Your organizer profile has been approved.",
      greeting: `Hi ${p.name},`,
      paragraphs: [
        `Good news: your organizer profile "${p.orgName}" has been verified.`,
        "Your public page now shows a verified badge, and you can publish events.",
      ],
      button: {
        label: "Open organizer dashboard",
        url: new URL("/organizer", env.FRONTEND_URL).toString(),
      },
      footer: "You received this because you applied to become an organizer.",
    }),
  }),
  "organizer.rejected": (p) => ({
    subject: `Update on your ${env.APP_NAME} organizer application`,
    ...layout({
      preheader: "Your organizer profile needs changes.",
      greeting: `Hi ${p.name},`,
      paragraphs: [
        `We couldn't verify your organizer profile "${p.orgName}" yet.`,
        `Reason: ${p.note}`,
        "Update your profile and it will be reviewed again automatically.",
      ],
      button: {
        label: "Edit organizer profile",
        url: new URL("/organizer/profile", env.FRONTEND_URL).toString(),
      },
      footer: "You received this because you applied to become an organizer.",
    }),
  }),
};

export function renderEmail(type: string, payload: unknown): RenderedEmail {
  const render = renderers[type as EmailType] as ((p: unknown) => RenderedEmail) | undefined;
  if (!render) throw new UnrecoverableError(`unknown email type: ${type}`);
  return render(payload);
}
