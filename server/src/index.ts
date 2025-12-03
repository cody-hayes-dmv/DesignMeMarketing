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

app.listen(PORT, async () => {
  console.log(`Server running on port ${PORT}`);
  
  // Start report scheduler cron job (runs every hour)
  const { processScheduledReports } = await import("./lib/reportScheduler.js");
  
  // Run immediately on startup (for testing)
  processScheduledReports().catch(console.error);
  
  // Then run every hour
  setInterval(() => {
    processScheduledReports().catch(console.error);
  }, 60 * 60 * 1000); // 1 hour in milliseconds
  
  console.log("Report scheduler started (runs every hour)");
});
