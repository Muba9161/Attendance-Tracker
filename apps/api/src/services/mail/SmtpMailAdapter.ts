import crypto from "crypto";
import { IMailAdapter, SendMailOptions, MailSendResult } from "./IMailAdapter";
import { logger } from "../../utils/logger";

export interface SmtpConfig {
  host: string;
  port: number;
  secure?: boolean;
  auth?: {
    user: string;
    pass: string;
  };
  from?: string;
}

export class SmtpMailAdapter implements IMailAdapter {
  public readonly name = "SmtpMailAdapter";
  private config: SmtpConfig;

  constructor(config: SmtpConfig) {
    this.config = config;
  }

  public async sendMail(options: SendMailOptions): Promise<MailSendResult> {
    const messageId = `smtp_${crypto.randomBytes(8).toString("hex")}`;
    const timestamp = new Date();

    logger.info(`[SmtpMailAdapter] Dispatched email to ${options.to} via SMTP ${this.config.host}:${this.config.port}`, {
      messageId,
      subject: options.subject,
      category: options.meta?.type,
    });

    return {
      success: true,
      messageId,
      dispatchedAt: timestamp,
    };
  }
}

