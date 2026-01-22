import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import authRoutes from "./routes/auth.js";
import agencyRoutes from "./routes/agencies.js";
import taskRoutes from "./routes/tasks.js";
import clientRoutes from "./routes/clients.js";
import seoRoutes from "./routes/seo.js";
import onboardingRoutes from "./routes/onboarding.js";
import teamRoutes from "./routes/team.js";
import uploadRoutes from "./routes/upload.js";
import { errorHandler } from "./middleware/errorHandler.js";

dotenv.config();

const app = express();
const PORT = process.env.PORT || 5000;

// Middleware
app.use(
  cors({
    origin: [
      "http://localhost:3000",
      "http://localhost:3001",
      "https://yourseodashboard.com",
      "https://app.yourseodashboard.com",
    ],
    credentials: true,
  })
);
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
app.use("/uploads", express.static("uploads")); // Serve uploaded files

// Health check
app.get("/health", (req, res) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

// Error handling
app.use(errorHandler);

const server = app.listen(PORT);

server.on("listening", async () => {
  console.log(`Server running on port ${PORT}`);

  // Start report scheduler cron job (runs every hour)
  const { processScheduledReports, refreshAllGA4Data } = await import("./lib/reportScheduler.js");
  const { autoSyncBacklinksForStaleClients } = await import("./routes/seo.js");

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
});

server.on("error", (err: any) => {
  if (err?.code === "EADDRINUSE") {
    console.error(`[Server] Port ${PORT} is already in use. Stop the other server process and retry.`);
    process.exit(1);
  }
  console.error("[Server] Failed to start:", err);
  process.exit(1);
});
