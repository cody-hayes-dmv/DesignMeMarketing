import { BRAND_DISPLAY_NAME } from "./qualityContracts.js";

type BillingEmailRow = {
  label: string;
  value: string;
};

type BillingEmailSection = {
  title: string;
  rows: BillingEmailRow[];
};

interface BillingEmailTemplateOptions {
  title: string;
  introLines: string[];
  sections: BillingEmailSection[];
  footerLines?: string[];
}

const escapeHtml = (value: unknown): string =>
  String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

const renderRows = (rows: BillingEmailRow[]) =>
  rows
    .map(
      (row) => `
        <tr>
          <td style="padding: 8px 0; color: #6b7280; font-size: 13px; width: 180px; vertical-align: top;">
            ${escapeHtml(row.label)}
          </td>
          <td style="padding: 8px 0; color: #111827; font-size: 13px; font-weight: 600;">
            ${escapeHtml(row.value)}
          </td>
        </tr>
      `
    )
    .join("");

const renderSections = (sections: BillingEmailSection[]) =>
  sections
    .map(
      (section) => `
        <div style="margin-top: 18px; border: 1px solid #e5e7eb; border-radius: 10px; padding: 14px 16px; background: #f9fafb;">
          <div style="font-size: 14px; font-weight: 700; color: #111827; margin-bottom: 8px;">
            ${escapeHtml(section.title)}
          </div>
          <table role="presentation" cellspacing="0" cellpadding="0" border="0" style="width: 100%;">
            ${renderRows(section.rows)}
          </table>
        </div>
      `
    )
    .join("");

export const renderBillingEmailTemplate = (options: BillingEmailTemplateOptions): string => {
  const introHtml = options.introLines
    .map((line) => `<p style="margin: 10px 0; color: #374151; font-size: 14px; line-height: 1.6;">${escapeHtml(line)}</p>`)
    .join("");
  const footerHtml = (options.footerLines ?? [])
    .map((line) => `<p style="margin: 6px 0; color: #6b7280; font-size: 12px; line-height: 1.5;">${escapeHtml(line)}</p>`)
    .join("");

  return `
    <div style="margin: 0; padding: 24px; background: #f3f4f6; font-family: Arial, Helvetica, sans-serif;">
      <div style="max-width: 680px; margin: 0 auto; background: #ffffff; border-radius: 14px; overflow: hidden; border: 1px solid #e5e7eb;">
        <div style="padding: 18px 22px; background: linear-gradient(90deg, #2563eb, #7c3aed); color: #ffffff;">
          <div style="font-size: 12px; opacity: 0.9; letter-spacing: 0.2px;">${escapeHtml(BRAND_DISPLAY_NAME)}</div>
          <div style="margin-top: 6px; font-size: 20px; font-weight: 700;">${escapeHtml(options.title)}</div>
        </div>
        <div style="padding: 22px;">
          ${introHtml}
          ${renderSections(options.sections)}
          <div style="margin-top: 20px; padding-top: 14px; border-top: 1px solid #e5e7eb;">
            ${footerHtml}
          </div>
        </div>
      </div>
    </div>
  `;
};
