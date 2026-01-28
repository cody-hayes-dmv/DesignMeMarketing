import nodemailer from "nodemailer";

interface EmailAttachment {
  filename: string;
  content: Buffer;
  contentType?: string;
}

interface EmailOptions {
  to: string;
  subject: string;
  html: string;
  attachments?: EmailAttachment[];
}

const EMAIL_DISABLED = process.env.EMAIL_DISABLED === "true";

// Lazy-load transporter to ensure env vars are loaded
let transporter: nodemailer.Transporter | null = null;

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
    // Add connection timeout and retry options
    connectionTimeout: 10000, // 10 seconds
    greetingTimeout: 10000,
    socketTimeout: 10000,
  });

  return transporter;
}

export const sendEmail = async ({ to, subject, html, attachments }: EmailOptions) => {
  try {
    if (EMAIL_DISABLED) {
      console.log(
        `[Email] EMAIL_DISABLED=true, skipping send to ${to}. Subject: "${subject}"`
      );
      return;
    }

    const emailTransporter = getTransporter();
    
    await emailTransporter.sendMail({
      from: process.env.SMTP_FROM || "noreply@yourseodashboard.com",
      to,
      subject,
      html,
      attachments,
    });
    console.log(`Email sent to ${to}`);
  } catch (error: any) {
    console.error("Email sending failed:", error);
    
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
