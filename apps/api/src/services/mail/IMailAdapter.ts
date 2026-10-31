export interface SendMailOptions {
  to: string;
  subject: string;
  html: string;
  text?: string;
  meta?: {
    type: "EMAIL_VERIFICATION" | "PASSWORD_RESET" | "STAFF_INVITATION";
    token?: string;
    actionUrl?: string;
    recipientName?: string;
    role?: string;
  };
}

export interface MailSendResult {
  success: boolean;
  messageId: string;
  dispatchedAt: Date;
  previewUrl?: string;
}

export interface IMailAdapter {
  readonly name: string;
  sendMail(options: SendMailOptions): Promise<MailSendResult>;
}

