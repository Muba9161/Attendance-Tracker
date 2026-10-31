import crypto from "crypto";
import { IMailAdapter, SendMailOptions, MailSendResult } from "./IMailAdapter";

export class ConsoleMailAdapter implements IMailAdapter {
  public readonly name = "ConsoleMailAdapter";
  private static sentMailsQueue: SendMailOptions[] = [];

  public static getSentMails(): SendMailOptions[] {
    return [...this.sentMailsQueue];
  }

  public static getLastSentMail(): SendMailOptions | undefined {
    return this.sentMailsQueue[this.sentMailsQueue.length - 1];
  }

  public static clearSentMails(): void {
    this.sentMailsQueue = [];
  }

  public getSentMails(): SendMailOptions[] {
    return ConsoleMailAdapter.getSentMails();
  }

  public clearSentMails(): void {
    ConsoleMailAdapter.clearSentMails();
  }

  public async sendMail(options: SendMailOptions): Promise<MailSendResult> {
    ConsoleMailAdapter.sentMailsQueue.push(options);

    const messageId = `msg_${crypto.randomBytes(8).toString("hex")}`;
    const timestamp = new Date();

    if (process.env.NODE_ENV !== "test") {
      const line = "=".repeat(78);
      console.log(`\n${line}`);
      console.log(` 📧 VORLDX MAIL ADAPTER (Simulated Console Delivery)`);
      console.log(`${line}`);
      console.log(` Message ID : ${messageId}`);
      console.log(` Timestamp  : ${timestamp.toISOString()}`);
      console.log(` To         : ${options.to}`);
      console.log(` Subject    : ${options.subject}`);
      if (options.meta?.type) {
        console.log(` Category   : ${options.meta.type}`);
      }
      if (options.meta?.actionUrl) {
        console.log(` Action URL : ${options.meta.actionUrl}`);
      }
      if (options.meta?.token) {
        console.log(` Raw Token  : ${options.meta.token} (Single-use, expires shortly)`);
      }
      console.log(`${line}\n`);
    }

    return {
      success: true,
      messageId,
      dispatchedAt: timestamp,
      previewUrl: options.meta?.actionUrl,
    };
  }
}
