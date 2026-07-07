import nodemailer from "nodemailer";

import { alertIssueLink, summarizeAlert } from "./format.js";

import type { Alert, NotificationChannel } from "./types.js";
import type { Transport, Transporter } from "nodemailer";

/**
 * Plain SMTP connection options, passed straight through to
 * `nodemailer.createTransport()` untouched. Shaped like (but not imported from)
 * nodemailer's own `SMTPTransport.Options` — a `NodeNext`-resolution deep import of
 * `nodemailer/lib/smtp-transport` doesn't resolve cleanly under this package's
 * TypeScript config, and duplicating the handful of fields actually needed here is
 * simpler than fighting that resolution.
 */
export interface SmtpConnectionOptions {
  host: string;
  port?: number;
  secure?: boolean;
  auth?: { user: string; pass: string };
}

/**
 * Options for an SMTP-based email notification channel. Accepts either plain SMTP
 * connection options (the common case) or a custom `Transport` implementation.
 */
export interface EmailChannelOptions {
  to: string | string[];
  from: string;
  transport: SmtpConnectionOptions | Transport | string;
  dashboardUrl?: string;
}

/**
 * Creates a channel that emails alerts over plain SMTP via `nodemailer` — deliberately
 * not tied to any specific mail vendor (unlike this repo's own `apps/api`, which uses
 * SendGrid's API directly), since forcing every self-hoster of this package onto one
 * vendor would be an unjustified lock-in. SMTP is universal; SendGrid itself supports
 * an SMTP relay, so this doesn't even exclude SendGrid users.
 */
export function emailChannel(options: EmailChannelOptions): NotificationChannel {
  const transporter = nodemailer.createTransport(
    options.transport as Parameters<typeof nodemailer.createTransport>[0]
  );
  return {
    name: "email",
    notify: (alert) => sendAlertEmail(transporter, options, alert)
  };
}

/**
 * Sends a single alert as a plain-text email.
 */
async function sendAlertEmail(
  transporter: Transporter,
  options: EmailChannelOptions,
  alert: Alert
): Promise<void> {
  const summary = summarizeAlert(alert);
  const link = alertIssueLink(alert, options.dashboardUrl);
  await transporter.sendMail({
    to: options.to,
    from: options.from,
    subject: summary,
    text: link ? `${summary}\n\n${link}` : summary
  });
}
