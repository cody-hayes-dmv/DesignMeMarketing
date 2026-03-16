import nodemailer from "nodemailer";
import {
  getWhitelabelFromAddress,
  normalizeWhitelabelText,
} from "./qualityContracts.js";

interface EmailAttachment {
  filename: string;
  content: Buffer | string;
  encoding?: "base64" | "utf-8" | "utf8" | "binary" | "hex";
  contentType?: string;
  cid?: string;
  contentDisposition?: "attachment" | "inline";
}

interface EmailOptions {
  to: string;
  subject: string;
  html: string;
  attachments?: EmailAttachment[];
}

export interface EmailSendResult {
  messageId: string | null;
  from: string;
  replyTo: string | null;
  to: string;
  subject: string;
}

const EMAIL_DISABLED = process.env.EMAIL_DISABLED === "true";

// Lazy-load transporter to ensure env vars are loaded
let transporter: nodemailer.Transporter | null = null;

function parsePositiveInt(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(String(value ?? "").trim(), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function htmlToPlainText(html: string): string {
  return String(html || "")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/\s+/g, " ")
    .trim();
}

function getTransporter(): nodemailer.Transporter {
  if (transporter) {
    return transporter;
  }

  const smtpHost = process.env.SMTP_HOST;
  const smtpPort = process.env.SMTP_PORT;
  const smtpUser = process.env.SMTP_USER;
  const smtpPass = process.env.SMTP_PASS;

  if (!smtpHost || !smtpPort || !smtpUser || !smtpPass) {
    const missing = [];
    if (!smtpHost) missing.push("SMTP_HOST");
    if (!smtpPort) missing.push("SMTP_PORT");
    if (!smtpUser) missing.push("SMTP_USER");
    if (!smtpPass) missing.push("SMTP_PASS");
    throw new Error(
      `Email configuration incomplete. Missing: ${missing.join(", ")}. Please check your .env file.`
    );
  }

  transporter = nodemailer.createTransport({
    host: smtpHost,
    port: parseInt(smtpPort),
    secure: process.env.SMTP_SECURE === "true",
    auth: {
      user: smtpUser,
      pass: smtpPass,
    },
    // Defaults are intentionally generous to support larger PDF attachments.
    connectionTimeout: parsePositiveInt(process.env.SMTP_CONNECTION_TIMEOUT_MS, 30000),
    greetingTimeout: parsePositiveInt(process.env.SMTP_GREETING_TIMEOUT_MS, 30000),
    socketTimeout: parsePositiveInt(process.env.SMTP_SOCKET_TIMEOUT_MS, 120000),
  });

  return transporter;
}

export const sendEmail = async ({ to, subject, html, attachments }: EmailOptions): Promise<EmailSendResult | null> => {
  try {
    if (EMAIL_DISABLED) {
      console.log(
        `[Email] EMAIL_DISABLED=true, skipping send to ${to}. Subject: "${subject}"`
      );
      return null;
    }

    const emailTransporter = getTransporter();
    const from = getWhitelabelFromAddress();
    const normalizedSubject = normalizeWhitelabelText(subject);
    const normalizedHtml = normalizeWhitelabelText(html);
    const normalizedText = htmlToPlainText(normalizedHtml);
    const replyTo = String(process.env.SMTP_REPLY_TO || "").trim() || undefined;
    console.log(`[Email] Attempting send to ${to}, subject: "${subject.slice(0, 50)}..."`);
    const result = await emailTransporter.sendMail({
      from,
      replyTo,
      to,
      subject: normalizedSubject,
      html: normalizedHtml,
      text: normalizedText,
      attachments,
    });
    console.log(`[Email] Sent successfully to ${to}, messageId: ${result.messageId || "n/a"}`);
    return {
      messageId: result.messageId || null,
      from,
      replyTo: replyTo || null,
      to,
      subject: normalizedSubject,
    };
  } catch (error: any) {
    console.error("[Email] Send failed:", error?.message || error);
    console.error("[Email] To:", to, "Subject:", subject?.slice(0, 40));
    
    // Provide more specific error messages
    if (error.code === "ECONNREFUSED" || error.code === "ESOCKET") {
      const smtpHost = process.env.SMTP_HOST || "localhost";
      throw new Error(
        `Failed to connect to email server at ${smtpHost}:${process.env.SMTP_PORT || "587"}. Please check your SMTP configuration in .env file.`
      );
    }
    
    if (error.message && error.message.includes("configuration")) {
      throw error; // Re-throw configuration errors as-is
    }
    
    throw new Error(`Failed to send email: ${error.message || "Unknown error"}`);
  }
};
