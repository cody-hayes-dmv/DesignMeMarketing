import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import { resolve } from "path";
import { fileURLToPath } from "url";
import { dirname } from "path";
import authRoutes from "./routes/auth.js";
import agencyRoutes from "./routes/agencies.js";
import taskRoutes from "./routes/tasks.js";
import clientRoutes from "./routes/clients.js";
import seoRoutes from "./routes/seo.js";
import onboardingRoutes from "./routes/onboarding.js";
import teamRoutes from "./routes/team.js";
import uploadRoutes from "./routes/upload.js";
import financialRoutes from "./routes/financial.js";
import aiCommandRoutes from "./routes/aiCommands.js";
import stripeWebhookRoutes from "./routes/stripeWebhook.js";
import { errorHandler } from "./middleware/errorHandler.js";

// Load .env file from server directory
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
dotenv.config({ path: resolve(__dirname, "../.env") });

// Validate critical environment variables
const requiredEnvVars = {
  JWT_SECRET: process.env.JWT_SECRET,
  DATABASE_URL: process.env.DATABASE_URL,
};

const missingVars = Object.entries(requiredEnvVars)
  .filter(([_, value]) => !value)
  .map(([key]) => key);

if (missingVars.length > 0) {
  console.error(`[Server] CRITICAL: Missing required environment variables: ${missingVars.join(', ')}`);
  console.error(`[Server] Please set these in server/.env file`);
  process.exit(1);
}

// Log email configuration status (without sensitive data)
console.log("[Email Config] SMTP_HOST:", process.env.SMTP_HOST ? `${process.env.SMTP_HOST.substring(0, 20)}...` : "NOT SET");
console.log("[Email Config] SMTP_PORT:", process.env.SMTP_PORT || "NOT SET");
console.log("[Email Config] SMTP_USER:", process.env.SMTP_USER ? `${process.env.SMTP_USER.substring(0, 10)}...` : "NOT SET");
console.log("[Email Config] SMTP_PASS:", process.env.SMTP_PASS ? "***SET***" : "NOT SET");

const app = express();
const PORT = process.env.PORT || 5000;

// CORS: allow CORS_ORIGINS env (comma-separated) or default list. Production domains must be included.
const defaultCorsOrigins = [
  "http://localhost:3000",
  "http://localhost:3001",
  "https://yourmarketingdashboard.ai",
  "https://app.yourmarketingdashboard.ai",
];
const corsOriginsEnv = process.env.CORS_ORIGINS?.trim();
const corsOrigins = corsOriginsEnv
  ? corsOriginsEnv.split(",").map((o) => o.trim()).filter(Boolean)
  : defaultCorsOrigins;

app.use(
  cors({
    origin: corsOrigins,
    credentials: true,
  })
);
// Stripe webhook needs raw body for signature verification (must be before express.json())
app.use("/api/webhooks/stripe", express.raw({ type: "application/json" }), stripeWebhookRoutes);
app.use(express.json());

// Routes
app.use("/api/auth", authRoutes);
app.use("/api/agencies", agencyRoutes);
app.use("/api/tasks", taskRoutes);
app.use("/api/clients", clientRoutes);
app.use("/api/seo", seoRoutes);
app.use("/api/onboarding", onboardingRoutes);
app.use("/api/team", teamRoutes);
app.use("/api/upload", uploadRoutes);
app.use("/api/financial", financialRoutes);
app.use("/api/ai-commands", aiCommandRoutes);
app.use("/uploads", express.static("uploads")); // Serve uploaded files

// Health check
app.get("/health", (req, res) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

// Error handling
app.use(errorHandler);

const server = app.listen(PORT);

// Handle unhandled promise rejections
process.on('unhandledRejection', (reason: any, promise: Promise<any>) => {
  console.error('[Server] Unhandled Promise Rejection:', reason);
  // Don't exit in production, but log the error
  if (process.env.NODE_ENV === 'production') {
    // In production, you might want to send this to a monitoring service
  }
});

// Handle uncaught exceptions
process.on('uncaughtException', (error: Error) => {
  console.error('[Server] Uncaught Exception:', error);
  // Exit gracefully
  process.exit(1);
});

server.on("listening", async () => {
  console.log(`Server running on port ${PORT}`);

  // Start report scheduler cron job (runs every hour)
  const { processScheduledReports, refreshAllGA4Data } = await import("./lib/reportScheduler.js");
  const { autoSyncBacklinksForStaleClients, autoRefreshSeoDataForDueClients } = await import("./routes/seo.js");
  const { archiveCanceledClientsPastEndDate, archiveScheduledClients } = await import("./lib/clientStatusWorkflow.js");
  const { processRecurringTaskRules } = await import("./routes/tasks.js");

  // Run immediately on startup (for testing)
  processScheduledReports().catch(console.error);

  // Then run every hour
  setInterval(() => {
    processScheduledReports().catch(console.error);
  }, 60 * 60 * 1000); // 1 hour in milliseconds

  // GA4 auto-refresh: Check every hour, but only runs on Monday mornings
  setInterval(() => {
    refreshAllGA4Data().catch(console.error);
  }, 60 * 60 * 1000); // Check every hour

  console.log("Report scheduler started (runs every hour)");
  console.log("GA4 auto-refresh scheduler started (runs Monday mornings)");

  // Client status: archive CANCELED clients when canceledEndDate has passed, and scheduled archives (run daily)
  archiveCanceledClientsPastEndDate().catch(console.error);
  archiveScheduledClients().catch(console.error);
  setInterval(() => {
    archiveCanceledClientsPastEndDate().catch(console.error);
    archiveScheduledClients().catch(console.error);
  }, 24 * 60 * 60 * 1000);
  console.log("Client status workflow started (archives canceled + scheduled clients daily)");

  // DataForSEO Backlinks auto-sync: run periodically, respecting 48h throttle per client.
  const backlinksAutoSyncEnabled =
    String(process.env.ENABLE_DATAFORSEO_BACKLINKS_AUTO_SYNC ?? "true").toLowerCase() === "true";
  const autoSyncIntervalMinutes = Math.min(
    24 * 60,
    Math.max(10, Number(process.env.DATAFORSEO_BACKLINKS_AUTO_SYNC_INTERVAL_MINUTES ?? 360))
  );
  const autoSyncBatchSize = Math.min(
    25,
    Math.max(1, Number(process.env.DATAFORSEO_BACKLINKS_AUTO_SYNC_BATCH_SIZE ?? 2))
  );

  if (backlinksAutoSyncEnabled) {
    // Run once shortly after startup, then on interval
    setTimeout(() => {
      autoSyncBacklinksForStaleClients({ batchSize: autoSyncBatchSize }).catch(console.error);
    }, 30 * 1000);

    setInterval(() => {
      autoSyncBacklinksForStaleClients({ batchSize: autoSyncBatchSize }).catch(console.error);
    }, autoSyncIntervalMinutes * 60 * 1000);

    console.log(
      `Backlinks auto-sync started (every ${autoSyncIntervalMinutes} minutes, batch size ${autoSyncBatchSize}, respects 48h throttle)`
    );
  } else {
    console.log("Backlinks auto-sync disabled (ENABLE_DATAFORSEO_BACKLINKS_AUTO_SYNC=false)");
  }

  // SEO data auto-refresh: Vendasta clients every 48h, other clients every 40h (dashboard/backlinks/top pages data)
  const seoAutoRefreshEnabled = String(process.env.ENABLE_SEO_AUTO_REFRESH ?? "true").toLowerCase() === "true";
  const seoAutoRefreshIntervalMinutes = Math.min(60 * 24, Math.max(30, Number(process.env.SEO_AUTO_REFRESH_INTERVAL_MINUTES ?? 60)));
  if (seoAutoRefreshEnabled) {
    setTimeout(() => {
      autoRefreshSeoDataForDueClients({ batchSize: 5 }).catch(console.error);
    }, 60 * 1000);
    setInterval(() => {
      autoRefreshSeoDataForDueClients({ batchSize: 5 }).catch(console.error);
    }, seoAutoRefreshIntervalMinutes * 60 * 1000);
    console.log(`SEO auto-refresh started (every ${seoAutoRefreshIntervalMinutes} min, Vendasta 48h / others 40h)`);
  } else {
    console.log("SEO auto-refresh disabled (ENABLE_SEO_AUTO_REFRESH=false)");
  }

  // Recurring tasks: create task instances from active rules (every minute)
  processRecurringTaskRules().catch(console.error);
  setInterval(() => {
    processRecurringTaskRules().catch(console.error);
  }, 60 * 1000);
  console.log("Recurring task scheduler started (runs every minute)");
});

server.on("error", (err: any) => {
  if (err?.code === "EADDRINUSE") {
    console.error(`[Server] Port ${PORT} is already in use. Stop the other server process and retry.`);
    process.exit(1);
  }
  console.error("[Server] Failed to start:", err);
  process.exit(1);
});
