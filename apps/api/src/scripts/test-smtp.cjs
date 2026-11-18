const fs = require("node:fs");
const path = require("node:path");
const dotenv = require("dotenv");
const nodemailer = require("nodemailer");

dotenv.config();
dotenv.config({ path: path.resolve(__dirname, "../../../../.env") });

async function main() {
  const senderEmail =
    process.env.SMTP_FROM_EMAIL || process.env.BREVO_SENDER_EMAIL || process.env.SMTP_FROM;
  const port = Number.parseInt(process.env.SMTP_PORT || "587", 10);
  if (!process.env.SMTP_HOST || !process.env.SMTP_USER || !process.env.SMTP_PASS || !senderEmail) {
    console.error(
      "SMTP verification failed: configure SMTP_HOST, SMTP_USER, SMTP_PASS, and SMTP_FROM_EMAIL (or SMTP_FROM/BREVO_SENDER_EMAIL)."
    );
    process.exitCode = 2;
    return;
  }

  const transport = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port,
    secure: process.env.SMTP_SECURE === "true" || port === 465,
    requireTLS: process.env.SMTP_SECURE !== "true" && port !== 465,
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
  });

  try {
    await transport.verify();
    console.log("SMTP connection verified. No email was sent.");
  } catch (error) {
    let message = typeof error.message === "string" ? error.message : "SMTP verification failed.";
    for (const secret of [
      process.env.SMTP_PASS,
      process.env.SMTP_USER,
      process.env.SMTP_FROM_EMAIL,
      process.env.SMTP_FROM,
      process.env.BREVO_SENDER_EMAIL,
    ]) {
      if (secret) message = message.split(secret).join("[REDACTED]");
    }
    message = message.replace(/\b\d{6}\b/g, "[REDACTED]").slice(0, 400);

    console.error("SMTP connection verification failed.");
    if (typeof error.code === "string") console.error(`Code: ${error.code}`);
    if (typeof error.command === "string") console.error(`Command: ${error.command}`);
    if (typeof error.responseCode === "number") console.error(`Response code: ${error.responseCode}`);
    console.error(`Details: ${message}`);
    process.exitCode = 1;
  } finally {
    transport.close();
  }
}

void main();
