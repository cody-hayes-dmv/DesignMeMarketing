import { prisma } from './prisma.js';
import { sendEmail } from './email.js';
import PDFDocument from 'pdfkit';

/**
 * Calculate next run time for a schedule
 */
export function calculateNextRunTime(
  frequency: string,
  dayOfWeek?: number,
  dayOfMonth?: number,
  timeOfDay: string = "09:00"
): Date {
  const [hours, minutes] = timeOfDay.split(":").map(Number);
  const now = new Date();
  const nextRun = new Date();

  nextRun.setHours(hours, minutes, 0, 0);

  if (frequency === "weekly" && dayOfWeek !== undefined) {
    const daysUntilNext = (dayOfWeek - now.getDay() + 7) % 7;
    if (daysUntilNext === 0 && nextRun <= now) {
      nextRun.setDate(nextRun.getDate() + 7);
    } else {
      nextRun.setDate(nextRun.getDate() + daysUntilNext);
    }
  } else if (frequency === "biweekly" && dayOfWeek !== undefined) {
    const daysUntilNext = (dayOfWeek - now.getDay() + 14) % 14;
    if (daysUntilNext === 0 && nextRun <= now) {
      nextRun.setDate(nextRun.getDate() + 14);
    } else {
      nextRun.setDate(nextRun.getDate() + daysUntilNext);
    }
  } else if (frequency === "monthly" && dayOfMonth !== undefined) {
    nextRun.setDate(dayOfMonth);
    if (nextRun <= now) {
      nextRun.setMonth(nextRun.getMonth() + 1);
    }
  } else {
    // Default: next week same day
    nextRun.setDate(nextRun.getDate() + 7);
  }

  return nextRun;
}

/**
 * Generate email HTML for a report
 */
export function generateReportEmailHTML(report: any, client: any): string {
  const periodLabel = report.period.charAt(0).toUpperCase() + report.period.slice(1);
  const reportDate = new Date(report.reportDate).toLocaleDateString();

  return `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>SEO Report - ${client.name}</title>
    </head>
    <body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
      <div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); padding: 30px; text-align: center; border-radius: 10px 10px 0 0;">
        <h1 style="color: white; margin: 0;">SEO Analytics Report</h1>
        <p style="color: rgba(255,255,255,0.9); margin: 10px 0 0 0;">${periodLabel} Report for ${client.name}</p>
      </div>
      
      <div style="background: #f9fafb; padding: 30px; border-radius: 0 0 10px 10px;">
        <div style="background: white; padding: 20px; border-radius: 8px; margin-bottom: 20px;">
          <h2 style="margin-top: 0; color: #1f2937;">Report Date: ${reportDate}</h2>
          
          <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 20px; margin-top: 20px;">
            <div style="background: #f3f4f6; padding: 15px; border-radius: 8px;">
              <p style="margin: 0; font-size: 12px; color: #6b7280; text-transform: uppercase;">Total Sessions</p>
              <p style="margin: 5px 0 0 0; font-size: 24px; font-weight: bold; color: #1f2937;">${report.totalSessions.toLocaleString()}</p>
            </div>
            <div style="background: #f3f4f6; padding: 15px; border-radius: 8px;">
              <p style="margin: 0; font-size: 12px; color: #6b7280; text-transform: uppercase;">Organic Sessions</p>
              <p style="margin: 5px 0 0 0; font-size: 24px; font-weight: bold; color: #10b981;">${report.organicSessions.toLocaleString()}</p>
            </div>
            ${report.activeUsers ? `
            <div style="background: #f3f4f6; padding: 15px; border-radius: 8px;">
              <p style="margin: 0; font-size: 12px; color: #6b7280; text-transform: uppercase;">Active Users</p>
              <p style="margin: 5px 0 0 0; font-size: 24px; font-weight: bold; color: #1f2937;">${report.activeUsers.toLocaleString()}</p>
            </div>
            ` : ''}
            ${report.newUsers ? `
            <div style="background: #f3f4f6; padding: 15px; border-radius: 8px;">
              <p style="margin: 0; font-size: 12px; color: #6b7280; text-transform: uppercase;">New Users</p>
              <p style="margin: 5px 0 0 0; font-size: 24px; font-weight: bold; color: #8b5cf6;">${report.newUsers.toLocaleString()}</p>
            </div>
            ` : ''}
            ${report.eventCount ? `
            <div style="background: #f3f4f6; padding: 15px; border-radius: 8px;">
              <p style="margin: 0; font-size: 12px; color: #6b7280; text-transform: uppercase;">Event Count</p>
              <p style="margin: 5px 0 0 0; font-size: 24px; font-weight: bold; color: #10b981;">${report.eventCount.toLocaleString()}</p>
            </div>
            ` : ''}
            ${report.keyEvents ? `
            <div style="background: #f3f4f6; padding: 15px; border-radius: 8px;">
              <p style="margin: 0; font-size: 12px; color: #6b7280; text-transform: uppercase;">Key Events</p>
              <p style="margin: 5px 0 0 0; font-size: 24px; font-weight: bold; color: #f59e0b;">${report.keyEvents.toLocaleString()}</p>
            </div>
            ` : ''}
          </div>

          <div style="margin-top: 30px; padding-top: 20px; border-top: 1px solid #e5e7eb;">
            <h3 style="margin-top: 0; color: #1f2937;">SEO Performance</h3>
            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 15px;">
              <div>
                <p style="margin: 0; font-size: 12px; color: #6b7280;">Average Position</p>
                <p style="margin: 5px 0 0 0; font-size: 20px; font-weight: bold; color: #1f2937;">${report.averagePosition.toFixed(1)}</p>
              </div>
              <div>
                <p style="margin: 0; font-size: 12px; color: #6b7280;">Total Clicks</p>
                <p style="margin: 5px 0 0 0; font-size: 20px; font-weight: bold; color: #1f2937;">${report.totalClicks.toLocaleString()}</p>
              </div>
              <div>
                <p style="margin: 0; font-size: 12px; color: #6b7280;">Total Impressions</p>
                <p style="margin: 5px 0 0 0; font-size: 20px; font-weight: bold; color: #1f2937;">${report.totalImpressions.toLocaleString()}</p>
              </div>
              <div>
                <p style="margin: 0; font-size: 12px; color: #6b7280;">Average CTR</p>
                <p style="margin: 5px 0 0 0; font-size: 20px; font-weight: bold; color: #1f2937;">${(report.averageCtr * 100).toFixed(2)}%</p>
              </div>
            </div>
          </div>

          ${report.conversions > 0 ? `
          <div style="margin-top: 30px; padding-top: 20px; border-top: 1px solid #e5e7eb;">
            <h3 style="margin-top: 0; color: #1f2937;">Conversions</h3>
            <p style="margin: 0; font-size: 18px; font-weight: bold; color: #10b981;">${report.conversions.toLocaleString()} conversions</p>
            ${report.conversionRate > 0 ? `<p style="margin: 5px 0 0 0; color: #6b7280;">Conversion Rate: ${(report.conversionRate * 100).toFixed(2)}%</p>` : ''}
          </div>
          ` : ''}
        </div>

        <p style="text-align: center; color: #6b7280; font-size: 12px; margin-top: 30px;">
          This is an automated report generated by SEO Dashboard.
        </p>
      </div>
    </body>
    </html>
  `;
}

/**
 * Generate a PDF buffer for a report
 * (keeps it simple: text-only summary matching the email content)
 */
export async function generateReportPDFBuffer(report: any, client: any): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 40 });
    const chunks: Buffer[] = [];

    // doc.on('data', (chunk) => chunks.push(chunk));
    doc.on("data", (chunk: Buffer) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    // doc.on('error', (err) => reject(err));
    doc.on("error", (err: Error) => reject(err));

    const periodLabel = report.period.charAt(0).toUpperCase() + report.period.slice(1);
    const reportDate = new Date(report.reportDate).toLocaleDateString();

    doc.fontSize(20).text(`SEO Analytics Report`, { align: 'center' });
    doc.moveDown(0.5);
    doc.fontSize(14).text(`${periodLabel} report for ${client.name}`, { align: 'center' });
    doc.moveDown();

    doc.fontSize(12).text(`Client: ${client.name}`);
    if (client.domain) {
      doc.text(`Domain: ${client.domain}`);
    }
    doc.text(`Report date: ${reportDate}`);

    doc.moveDown();
    doc.fontSize(14).text('Traffic Overview', { underline: true });
    doc.moveDown(0.5);
    doc.fontSize(12);
    doc.text(`Total Sessions: ${report.totalSessions?.toLocaleString?.() ?? report.totalSessions ?? 0}`);
    doc.text(`Organic Sessions: ${report.organicSessions?.toLocaleString?.() ?? report.organicSessions ?? 0}`);
    if (report.activeUsers != null) doc.text(`Active Users: ${report.activeUsers}`);
    if (report.newUsers != null) doc.text(`New Users: ${report.newUsers}`);
    if (report.eventCount != null) doc.text(`Event Count: ${report.eventCount}`);
    if (report.keyEvents != null) doc.text(`Key Events: ${report.keyEvents}`);

    doc.moveDown();
    doc.fontSize(14).text('SEO Performance', { underline: true });
    doc.moveDown(0.5);
    doc.fontSize(12);
    if (report.averagePosition != null) {
      doc.text(`Average Position: ${Number(report.averagePosition).toFixed(1)}`);
    }
    doc.text(`Total Clicks: ${report.totalClicks?.toLocaleString?.() ?? report.totalClicks ?? 0}`);
    doc.text(`Total Impressions: ${report.totalImpressions?.toLocaleString?.() ?? report.totalImpressions ?? 0}`);
    if (report.averageCtr != null) {
      doc.text(`Average CTR: ${(Number(report.averageCtr) * 100).toFixed(2)}%`);
    }

    if (report.conversions != null && report.conversions > 0) {
      doc.moveDown();
      doc.fontSize(14).text('Conversions', { underline: true });
      doc.moveDown(0.5);
      doc.fontSize(12);
      doc.text(`Conversions: ${report.conversions}`);
      if (report.conversionRate != null) {
        doc.text(`Conversion Rate: ${(Number(report.conversionRate) * 100).toFixed(2)}%`);
      }
    }

    doc.moveDown(2);
    doc.fontSize(10).fillColor('#666').text(
      'This PDF was generated automatically by SEO Dashboard based on the latest available analytics data.',
      { align: 'center' }
    );

    doc.end();
  });
}

/**
 * Auto-generate a report for a client
 */
export async function autoGenerateReport(clientId: string, period: string = "monthly"): Promise<any> {
  const client = await prisma.client.findUnique({
    where: { id: clientId },
    include: {
      user: true
    }
  });

  if (!client) {
    throw new Error('Client not found');
  }

  // Calculate date range based on period
  const endDate = new Date();
  const startDate = new Date();
  
  if (period === "weekly") {
    startDate.setDate(startDate.getDate() - 7);
  } else if (period === "biweekly") {
    startDate.setDate(startDate.getDate() - 14);
  } else if (period === "monthly") {
    startDate.setMonth(startDate.getMonth() - 1);
  } else {
    startDate.setDate(startDate.getDate() - 30);
  }

  // Fetch dashboard data (this will get GA4 + DataForSEO data)
  // We'll need to call the dashboard endpoint logic directly
  const days = Math.ceil((endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24));
  
  // Get GA4 data if connected
  let ga4Data: any = null;
  const isGA4Connected = !!(client.ga4RefreshToken && client.ga4PropertyId && client.ga4ConnectedAt);
  
  if (isGA4Connected) {
    try {
      const { fetchGA4TrafficData } = await import('./ga4.js');
      ga4Data = await fetchGA4TrafficData(clientId, startDate, endDate);
    } catch (error) {
      console.error(`Failed to fetch GA4 data for client ${clientId}:`, error);
    }
  }

  // Get keyword stats
  const keywordStats = await prisma.keyword.aggregate({
    where: { clientId },
    _count: { id: true },
    _avg: { 
      currentPosition: true,
      ctr: true
    },
    _sum: {
      clicks: true,
      impressions: true
    }
  });

  // Get traffic sources
  const trafficSources = await prisma.trafficSource.findMany({
    where: { clientId },
  });

  const firstSource = trafficSources[0];
  const trafficSourceSummary = firstSource ? {
    totalEstimatedTraffic: firstSource.totalEstimatedTraffic,
    organicEstimatedTraffic: firstSource.organicEstimatedTraffic,
    averageRank: firstSource.averageRank,
  } : null;

  // Create report data
  const reportData = {
    reportDate: endDate,
    period: period,
    status: "draft" as string,
    totalSessions: Math.round(ga4Data?.totalSessions || trafficSourceSummary?.totalEstimatedTraffic || 0),
    organicSessions: Math.round(ga4Data?.organicSessions || trafficSourceSummary?.organicEstimatedTraffic || 0),
    paidSessions: 0,
    directSessions: 0,
    referralSessions: 0,
    totalClicks: keywordStats._sum.clicks || 0,
    totalImpressions: keywordStats._sum.impressions || 0,
    averageCtr: keywordStats._avg.ctr || 0,
    averagePosition: trafficSourceSummary?.averageRank || keywordStats._avg.currentPosition || 0,
    bounceRate: ga4Data?.bounceRate || 0,
    avgSessionDuration: ga4Data?.avgSessionDuration || 0,
    pagesPerSession: ga4Data?.pagesPerSession || 0,
    conversions: Math.round(ga4Data?.conversions || 0),
    conversionRate: ga4Data?.conversionRate || 0,
    activeUsers: Math.round(ga4Data?.activeUsers || 0),
    eventCount: Math.round(ga4Data?.eventCount || 0),
    newUsers: Math.round(ga4Data?.newUsers || 0),
    keyEvents: Math.round(ga4Data?.keyEvents || 0),
  };

  // Upsert report (one report per client)
  // Use findFirst instead of findUnique(clientId) to be compatible with older Prisma clients
  const existing = await prisma.seoReport.findFirst({
    where: { clientId }
  });

  // Check if there's an active schedule for this client
  const activeSchedule = await prisma.reportSchedule.findFirst({
    where: {
      clientId,
      isActive: true
    }
  });

  // If there's an active schedule, set status to "scheduled" instead of "draft"
  if (activeSchedule && reportData.status === "draft") {
    reportData.status = "scheduled";
  }

  const report = existing
    ? await prisma.seoReport.update({
        where: { id: existing.id },
        data: {
          ...reportData,
          scheduleId: activeSchedule?.id || existing.scheduleId || null
        }
      })
    : await prisma.seoReport.create({
        data: {
          ...reportData,
          clientId,
          scheduleId: activeSchedule?.id || null
        }
      });

  return report;
}

/**
 * Auto-refresh GA4 data for all connected clients (runs every Monday morning)
 */
export async function refreshAllGA4Data(): Promise<void> {
  try {
    const now = new Date();
    const dayOfWeek = now.getDay(); // 0 = Sunday, 1 = Monday, etc.
    const hour = now.getHours();
    
    // Only run on Monday mornings (1 = Monday, between 1 AM and 9 AM)
    if (dayOfWeek !== 1 || hour < 1 || hour > 9) {
      return;
    }

    console.log(`[GA4 Auto-Refresh] Starting Monday morning refresh at ${now.toISOString()}`);
    
    // Find all clients with GA4 connected
    const connectedClients = await prisma.client.findMany({
      where: {
        ga4RefreshToken: { not: null },
        ga4PropertyId: { not: null },
        ga4ConnectedAt: { not: null }
      },
      select: {
        id: true,
        name: true,
        ga4PropertyId: true
      }
    });

    console.log(`[GA4 Auto-Refresh] Found ${connectedClients.length} clients with GA4 connected`);

    // Refresh data for each client in parallel (but limit concurrency)
    const refreshPromises = connectedClients.map(async (client) => {
      try {
        const { fetchGA4TrafficData, fetchGA4EventsData, saveGA4MetricsToDB } = await import('./ga4.js');
        const endDate = new Date();
        const startDate = new Date();
        startDate.setDate(startDate.getDate() - 30); // Last 30 days

        const [trafficData, eventsData] = await Promise.all([
          fetchGA4TrafficData(client.id, startDate, endDate).catch(err => {
            console.warn(`[GA4 Auto-Refresh] Failed to refresh traffic for ${client.name}:`, err.message);
            return null;
          }),
          fetchGA4EventsData(client.id, startDate, endDate).catch(err => {
            console.warn(`[GA4 Auto-Refresh] Failed to refresh events for ${client.name}:`, err.message);
            return null;
          })
        ]);

        // Save to database if we got data
        if (trafficData) {
          await saveGA4MetricsToDB(client.id, startDate, endDate, trafficData, eventsData || undefined);
          console.log(`[GA4 Auto-Refresh] ✅ Refreshed and saved data for ${client.name}`);
        }
      } catch (error: any) {
        console.error(`[GA4 Auto-Refresh] ❌ Failed to refresh ${client.name}:`, error.message);
      }
    });

    await Promise.allSettled(refreshPromises);
    console.log(`[GA4 Auto-Refresh] Completed refresh for ${connectedClients.length} clients`);
  } catch (error: any) {
    console.error('[GA4 Auto-Refresh] Error:', error);
  }
}

/**
 * Process scheduled reports - called by cron job
 */
export async function processScheduledReports(): Promise<void> {
  try {
    const now = new Date();
    
    // Find all active schedules that are due
    const dueSchedules = await prisma.reportSchedule.findMany({
      where: {
        isActive: true,
        nextRunAt: {
          lte: now
        }
      },
      include: {
        client: true
      }
    });

    console.log(`[Report Scheduler] Checking scheduled reports at ${now.toISOString()}`);
    console.log(`[Report Scheduler] Found ${dueSchedules.length} due schedule(s)`);
    
    if (dueSchedules.length === 0) {
      // Log all active schedules for debugging
      const allActiveSchedules = await prisma.reportSchedule.findMany({
        where: { isActive: true },
        select: {
          id: true,
          clientId: true,
          frequency: true,
          nextRunAt: true,
          recipients: true
        }
      });
      if (allActiveSchedules.length > 0) {
        console.log(`[Report Scheduler] Active schedules (not due yet):`, allActiveSchedules.map(s => ({
          id: s.id,
          frequency: s.frequency,
          nextRunAt: s.nextRunAt?.toISOString(),
          recipients: s.recipients
        })));
      }
      return;
    }

    for (const schedule of dueSchedules) {
      try {
        console.log(`[Report Scheduler] Processing schedule ${schedule.id} for client ${schedule.client.name}`);
        
        // Generate report
        const report = await autoGenerateReport(schedule.clientId, schedule.frequency);
        console.log(`[Report Scheduler] Report generated: ${report.id}`);
        
        // Link report to schedule
        await prisma.seoReport.update({
          where: { id: report.id },
          data: { scheduleId: schedule.id }
        });

        // Send email to recipients (stored as JSON string)
        const recipients: string[] = (() => {
          if (!schedule.recipients) return [];
          try {
            const parsed = JSON.parse(String(schedule.recipients));
            return Array.isArray(parsed) ? parsed : [];
          } catch {
            return [];
          }
        })();
        if (recipients && recipients.length > 0) {
          console.log(`[Report Scheduler] Sending emails to: ${recipients.join(", ")}`);
          
          const emailHtml = generateReportEmailHTML(report, schedule.client);
          const emailSubject = schedule.emailSubject || `SEO Report - ${schedule.client.name} - ${schedule.frequency.charAt(0).toUpperCase() + schedule.frequency.slice(1)}`;
          const pdfBuffer = await generateReportPDFBuffer(report, schedule.client);

          const emailPromises = recipients.map((email: string) =>
            sendEmail({
              to: email,
              subject: emailSubject,
              html: emailHtml,
              attachments: [
                {
                  filename: `seo-report-${schedule.client.name.replace(/\s+/g, '-').toLowerCase()}-${report.period}.pdf`,
                  content: pdfBuffer,
                  contentType: 'application/pdf'
                }
              ]
            }).then(() => {
              console.log(`[Report Scheduler] Email sent successfully to ${email}`);
            }).catch((error) => {
              console.error(`[Report Scheduler] Failed to send email to ${email}:`, error);
              throw error;
            })
          );

          await Promise.all(emailPromises);

          // Update report status
          await prisma.seoReport.update({
            where: { id: report.id },
            data: {
              status: "sent",
              sentAt: new Date(),
              // SeoReport.recipients is a String column; store as JSON for consistency with ReportSchedule.recipients.
              recipients: JSON.stringify(recipients),
              emailSubject
            }
          });

          console.log(`[Report Scheduler] ✓ Report generated and sent for client ${schedule.client.name} (${schedule.frequency})`);
        } else {
          console.log(`[Report Scheduler] ⚠ No recipients configured for schedule ${schedule.id}`);
        }

        // Calculate and update next run time
        const nextRunAt = calculateNextRunTime(
          schedule.frequency,
          schedule.dayOfWeek || undefined,
          schedule.dayOfMonth || undefined,
          schedule.timeOfDay
        );

        await prisma.reportSchedule.update({
          where: { id: schedule.id },
          data: {
            lastRunAt: now,
            nextRunAt
          }
        });

        console.log(`[Report Scheduler] Next run scheduled for: ${nextRunAt.toISOString()}`);

      } catch (error: any) {
        console.error(`[Report Scheduler] ✗ Failed to process schedule ${schedule.id} for client ${schedule.clientId}:`, error);
        console.error(`[Report Scheduler] Error details:`, error.message, error.stack);
        // Continue with other schedules even if one fails
      }
    }

    console.log(`[Report Scheduler] Finished processing scheduled reports.`);
  } catch (error: any) {
    console.error('[Report Scheduler] Error processing scheduled reports:', error);
    console.error('[Report Scheduler] Error details:', error.message, error.stack);
  }
}

