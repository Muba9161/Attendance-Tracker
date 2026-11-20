import crypto from "crypto";
import nodemailer, { Transporter } from "nodemailer";
import { IMailAdapter, SendMailOptions, MailSendResult } from "./IMailAdapter";
import { logger } from "../../utils/logger";

export interface SmtpConfig {
  host: string;
  port: number;
  secure: boolean;
  auth: {
    user: string;
    pass: string;
  };
  from: string;
  fromName?: string;
}

export class SmtpMailAdapter implements IMailAdapter {
  public readonly name = "SmtpMailAdapter";
  private transporter: Transporter;
  private from: string | { name: string; address: string };

  constructor(config: SmtpConfig) {
    this.from = config.fromName
      ? { name: config.fromName, address: config.from }
      : config.from;
    this.transporter = nodemailer.createTransport({
      host: config.host,
      port: config.port,
      secure: config.secure,
      requireTLS: !config.secure,
      auth: config.auth,
    });
  }

  public async verifyConnection(): Promise<void> {
    await this.transporter.verify();
    logger.info("[SmtpMailAdapter] SMTP connection verified");
  }

  public async sendMail(options: SendMailOptions): Promise<MailSendResult> {
    const fallbackMessageId = `smtp_${crypto.randomBytes(8).toString("hex")}`;
    const timestamp = new Date();

    const sent = await this.transporter.sendMail({
      from: this.from,
      to: options.to,
      subject: options.subject,
      html: options.html,
      text: options.text,
    });
    const messageId = sent.messageId || fallbackMessageId;

    logger.info("[SmtpMailAdapter] Email accepted by SMTP server", {
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

