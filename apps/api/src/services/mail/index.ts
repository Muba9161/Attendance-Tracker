import { IMailAdapter } from "./IMailAdapter";
import { ConsoleMailAdapter } from "./ConsoleMailAdapter";
import { SmtpMailAdapter } from "./SmtpMailAdapter";
import { BrevoMailAdapter } from "./BrevoMailAdapter";
import { env } from "../../config/env";

export * from "./IMailAdapter";
export * from "./ConsoleMailAdapter";
export * from "./SmtpMailAdapter";
export * from "./BrevoMailAdapter";

let activeAdapter: IMailAdapter | null = null;
let activeBrevoAdapter: IMailAdapter | null = null;
let activeSmtpAdapter: SmtpMailAdapter | null = null;
let testAdapter: IMailAdapter | null = null;

export function getBrevoMailAdapter(): IMailAdapter {
  if (testAdapter) return testAdapter;
  if (activeBrevoAdapter) return activeBrevoAdapter;

  const apiKey = process.env.BREVO_API_KEY;
  const senderEmail = process.env.BREVO_SENDER_EMAIL;
  const senderName = process.env.BREVO_SENDER_NAME || "VORLDX Employee Attendance System";
  if (!apiKey || !senderEmail) {
    throw new Error("Brevo email is not configured. Set BREVO_API_KEY and BREVO_SENDER_EMAIL.");
  }

  activeBrevoAdapter = new BrevoMailAdapter(apiKey, senderEmail, senderName);
  return activeBrevoAdapter;
}

/** Nodemailer SMTP transport shared by mail flows that explicitly choose SMTP. */
export function getSmtpMailAdapter(): SmtpMailAdapter {
  if (testAdapter) return testAdapter as SmtpMailAdapter;
  if (activeSmtpAdapter) return activeSmtpAdapter;

  const host = process.env.SMTP_HOST;
  const port = process.env.SMTP_PORT ? Number.parseInt(process.env.SMTP_PORT, 10) : 587;
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  const senderEmail = process.env.SMTP_FROM_EMAIL || process.env.SMTP_FROM || process.env.BREVO_SENDER_EMAIL;
  const senderName = process.env.SMTP_FROM_EMAIL
    ? process.env.SMTP_FROM_NAME || "VORLDX INDUSTRIES PRIVATE LIMITED"
    : process.env.BREVO_SENDER_EMAIL
      ? process.env.BREVO_SENDER_NAME || "VORLDX Employee Attendance System"
    : undefined;

  if (!host || !user || !pass || !senderEmail) {
    throw new Error(
      "SMTP is not fully configured. Set SMTP_HOST, SMTP_USER, SMTP_PASS, and SMTP_FROM_EMAIL."
    );
  }
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error("SMTP_PORT must be an integer between 1 and 65535.");
  }

  activeSmtpAdapter = new SmtpMailAdapter({
    host,
    port,
    secure: process.env.SMTP_SECURE === "true" || port === 465,
    auth: { user, pass },
    from: senderEmail,
    fromName: senderName,
  });
  return activeSmtpAdapter;
}

export function getMailAdapter(): IMailAdapter {
  if (testAdapter) return testAdapter;
  if (activeAdapter) {
    return activeAdapter;
  }

  // Prefer the already configured Brevo transactional provider for every mail
  // flow, including HR invitations. Previously invitations only used SMTP,
  // even when Brevo was configured for signup verification.
  const brevoApiKey = process.env.BREVO_API_KEY;
  const brevoSenderEmail = process.env.BREVO_SENDER_EMAIL;
  const hasAnyBrevoSetting = Boolean(brevoApiKey || brevoSenderEmail);
  if (brevoApiKey && brevoSenderEmail) {
    activeAdapter = getBrevoMailAdapter();
    return activeAdapter;
  }

  if (hasAnyBrevoSetting) {
    throw new Error(
      "Brevo email is not fully configured. Set both BREVO_API_KEY and BREVO_SENDER_EMAIL."
    );
  }

  const smtpHost = process.env.SMTP_HOST;
  const smtpPort = process.env.SMTP_PORT ? parseInt(process.env.SMTP_PORT, 10) : 587;
  const smtpUser = process.env.SMTP_USER;
  const smtpPass = process.env.SMTP_PASS;
  const smtpFrom = process.env.SMTP_FROM;
  const smtpSecure = process.env.SMTP_SECURE === "true" || smtpPort === 465;
  const hasAnySmtpSetting = Boolean(
    process.env.SMTP_HOST ||
      process.env.SMTP_USER ||
      process.env.SMTP_PASS ||
      process.env.SMTP_FROM
  );
  const hasCompleteSmtpSettings = Boolean(process.env.SMTP_HOST && smtpUser && smtpPass && smtpFrom);

  if (hasCompleteSmtpSettings && smtpHost && smtpUser && smtpPass && smtpFrom) {
    if (!Number.isInteger(smtpPort) || smtpPort < 1 || smtpPort > 65535) {
      throw new Error("SMTP_PORT must be an integer between 1 and 65535.");
    }

    activeAdapter = new SmtpMailAdapter({
      host: smtpHost,
      port: smtpPort,
      secure: smtpSecure,
      auth: { user: smtpUser, pass: smtpPass },
      from: smtpFrom,
    });
    return activeAdapter;
  }

  if (env.NODE_ENV === "production" || hasAnySmtpSetting) {
    throw new Error(
      "SMTP is not fully configured. Set SMTP_HOST, SMTP_USER, SMTP_PASS, and SMTP_FROM; SMTP_PORT defaults to 587 and SMTP_SECURE defaults based on the port."
    );
  }

  // Console delivery is only a local development/test fallback.
  activeAdapter = new ConsoleMailAdapter();
  return activeAdapter;
}

export function setMailAdapterForTesting(adapter: IMailAdapter | null): void {
  testAdapter = adapter;
  activeAdapter = null;
  activeBrevoAdapter = null;
  activeSmtpAdapter = null;
}

