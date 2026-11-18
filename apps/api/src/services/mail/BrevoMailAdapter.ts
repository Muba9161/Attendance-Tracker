import crypto from "crypto";
import { logger } from "../../utils/logger";
import { IMailAdapter, MailSendResult, SendMailOptions } from "./IMailAdapter";

export class BrevoMailDeliveryError extends Error {
  constructor(
    public readonly status: number,
    public readonly providerCode: string | null,
    public readonly providerMessage: string
  ) {
    super(`Brevo email delivery failed (HTTP ${status}${providerCode ? `, ${providerCode}` : ""}).`);
    this.name = "BrevoMailDeliveryError";
  }
}

export class BrevoMailAdapter implements IMailAdapter {
  public readonly name = "BrevoMailAdapter";

  constructor(
    private readonly apiKey: string,
    private readonly senderEmail: string,
    private readonly senderName: string
  ) {}

  public async sendMail(options: SendMailOptions): Promise<MailSendResult> {
    const response = await fetch("https://api.brevo.com/v3/smtp/email", {
      method: "POST",
      headers: {
        "api-key": this.apiKey,
        "Content-Type": "application/json",
        accept: "application/json",
      },
      signal: AbortSignal.timeout(10_000),
      body: JSON.stringify({
        sender: { email: this.senderEmail, name: this.senderName },
        to: [{ email: options.to }],
        subject: options.subject,
        htmlContent: options.html,
        textContent: options.text,
      }),
    });

    if (!response.ok) {
      let providerCode: string | null = null;
      let providerMessage = "Brevo rejected the transactional email request.";
      try {
        const body = (await response.json()) as { code?: unknown; message?: unknown };
        if (typeof body.code === "string") providerCode = body.code.slice(0, 100);
        if (typeof body.message === "string") providerMessage = body.message;
      } catch {
        // Keep the HTTP status if Brevo did not return a JSON error body.
      }

      // Provider details help diagnose configuration, but never retain credentials or OTPs.
      const safeMessage = providerMessage
        .split(this.apiKey).join("[REDACTED]")
        .replace(/\b\d{6}\b/g, "[REDACTED]")
        .slice(0, 500);
      logger.error("Brevo rejected transactional email", {
        status: response.status,
        code: providerCode,
        message: safeMessage,
      });
      throw new BrevoMailDeliveryError(response.status, providerCode, safeMessage);
    }

    const result = (await response.json()) as { messageId?: string };
    const messageId = result.messageId || `brevo_${crypto.randomBytes(8).toString("hex")}`;
    logger.info("Brevo accepted transactional email", { messageId, category: options.meta?.type });

    return { success: true, messageId, dispatchedAt: new Date() };
  }
}
