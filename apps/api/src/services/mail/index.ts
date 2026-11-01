import { IMailAdapter } from "./IMailAdapter";
import { ConsoleMailAdapter } from "./ConsoleMailAdapter";
import { SmtpMailAdapter } from "./SmtpMailAdapter";
import { env } from "../../config/env";

export * from "./IMailAdapter";
export * from "./ConsoleMailAdapter";
export * from "./SmtpMailAdapter";

let activeAdapter: IMailAdapter | null = null;

export function getMailAdapter(): IMailAdapter {
  if (activeAdapter) {
    return activeAdapter;
  }

  const smtpHost = process.env.SMTP_HOST;
  const smtpPort = process.env.SMTP_PORT ? parseInt(process.env.SMTP_PORT, 10) : 587;
  const smtpUser = process.env.SMTP_USER;
  const smtpPass = process.env.SMTP_PASS;

  if (env.NODE_ENV === "production" && smtpHost && smtpUser && smtpPass) {
    activeAdapter = new SmtpMailAdapter({
      host: smtpHost,
      port: smtpPort,
      auth: { user: smtpUser, pass: smtpPass },
      from: process.env.SMTP_FROM || "no-reply@vorldx.com",
    });
    return activeAdapter;
  }

  // Development & Test Mode Console Adapter
  activeAdapter = new ConsoleMailAdapter();
  return activeAdapter;
}

export function setMailAdapterForTesting(adapter: IMailAdapter | null): void {
  activeAdapter = adapter;
}

