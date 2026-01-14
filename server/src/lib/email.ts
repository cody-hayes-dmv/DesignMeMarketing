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

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST || "localhost",
  port: parseInt(process.env.SMTP_PORT || "587"),
  secure: process.env.SMTP_SECURE === "true",
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
});

export const sendEmail = async ({ to, subject, html, attachments }: EmailOptions) => {
  try {
    if (EMAIL_DISABLED) {
      console.log(
        `[Email] EMAIL_DISABLED=true, skipping send to ${to}. Subject: "${subject}"`
      );
      return;
    }

    await transporter.sendMail({
      from: process.env.SMTP_FROM || "noreply@yourseodashboard.com",
      to,
      subject,
      html,
      attachments,
    });
    console.log(`Email sent to ${to}`);
  } catch (error) {
    console.error("Email sending failed:", error);
    throw new Error("Failed to send email");
  }
};
