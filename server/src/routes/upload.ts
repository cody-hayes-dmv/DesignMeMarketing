import express from "express";
import multer from "multer";
import path from "path";
import fs from "fs";
import { authenticateToken, optionalAuthenticateToken } from "../middleware/auth.js";
import { requireAgencyTrialNotExpired } from "../middleware/requireAgencyTrialNotExpired.js";

const router = express.Router();

// Restrict agency users with expired trial
router.use(optionalAuthenticateToken, requireAgencyTrialNotExpired);

// Create uploads directory if it doesn't exist
const uploadsDir = path.join(process.cwd(), "uploads");
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

/**
 * Sanitize filename for URL-safe storage and downloads (no spaces or problematic chars).
 * Replaces spaces and other unsafe characters with hyphens so links work on all platforms.
 */
function sanitizeFilenameForUrl(name: string): string {
  return name
    .replace(/\s+/g, "-")
    .replace(/[#%?&=[\]{}|\\<>"']/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "") || "file";
}


// Configure multer for file uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadsDir);
  },
  filename: (req, file, cb) => {
    // Generate unique filename: timestamp-random-sanitized-name (no spaces for URL-safe downloads)
    const uniqueSuffix = Date.now() + "-" + Math.round(Math.random() * 1e9);
    const ext = path.extname(file.originalname);
    const baseName = path.basename(file.originalname, ext);
    const safeName = sanitizeFilenameForUrl(baseName);
    cb(null, `${safeName}-${uniqueSuffix}${ext}`);
  },
});

// File filter: only allow images and videos
const fileFilter = (req: express.Request, file: Express.Multer.File, cb: multer.FileFilterCallback) => {
  const allowedMimes = [
    // Images
    "image/jpeg",
    "image/jpg",
    "image/png",
    "image/gif",
    "image/webp",
    // Videos
    "video/mp4",
    "video/mpeg",
    "video/quicktime",
    "video/x-msvideo", // .avi
    "video/webm",
  ];

  if (allowedMimes.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error("Invalid file type. Only images and videos are allowed."));
  }
};

const upload = multer({
  storage,
  fileFilter,
  limits: {
    fileSize: 50 * 1024 * 1024, // 50MB max file size
  },
});

// Upload single file
router.post("/", authenticateToken, upload.single("file"), (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ message: "No file uploaded" });
    }

    // Determine file type based on mimetype
    let fileType: "image" | "video" = "image";
    if (req.file.mimetype.startsWith("video/")) {
      fileType = "video";
    }

    // Return download URL that always hits the backend (BACKEND_URL in production for correct domain)
    const baseUrl = (process.env.BACKEND_URL || process.env.API_URL || `${req.protocol}://${req.get("host")}`).replace(/\/$/, "");
    const downloadPath = `/api/upload/${req.file.filename}`;
    const fullUrl = `${baseUrl}${downloadPath}`;

    res.json({
      type: fileType,
      value: fullUrl,
      name: req.file.originalname,
    });
  } catch (error: any) {
    console.error("Upload error:", error);
    res.status(500).json({ message: "Failed to upload file" });
  }
});

// File filter for work log attachments (PDF, docs, images, etc.)
const workLogFileFilter = (req: express.Request, file: Express.Multer.File, cb: multer.FileFilterCallback) => {
  const allowedMimes = [
    "image/jpeg",
    "image/jpg",
    "image/png",
    "image/gif",
    "image/webp",
    "video/mp4",
    "video/mpeg",
    "video/quicktime",
    "video/webm",
    "application/pdf",
    "application/msword", // .doc
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document", // .docx
    "application/vnd.ms-excel", // .xls
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", // .xlsx
    "text/plain",
    "text/csv",
    "application/octet-stream", // fallback when OS/browser reports unknown type
  ];
  if (allowedMimes.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error("Invalid file type. Allowed: PDF, Word, Excel, images, videos, text, CSV."));
  }
};

const uploadWorkLog = multer({
  storage,
  fileFilter: workLogFileFilter,
  limits: { fileSize: 25 * 1024 * 1024 }, // 25MB per file
});

// Work log: multiple files in one request (same pattern as /upload/multiple), field name "files"
router.post("/worklog", authenticateToken, (req, res, next) => {
  uploadWorkLog.array("files", 10)(req, res, (err: any) => {
    if (err) {
      const message = err.message || "Invalid file. Allowed: PDF, Word, Excel, images, videos, text, CSV. Max 25MB per file.";
      return res.status(400).json({ message });
    }
    next();
  });
}, (req: express.Request, res: express.Response) => {
  try {
    const files = req.files as Express.Multer.File[] | undefined;
    if (!files || files.length === 0) {
      return res.status(400).json({ message: "No files uploaded" });
    }
    const baseUrl = (process.env.BACKEND_URL || process.env.API_URL || `${req.protocol}://${req.get("host")}`).replace(/\/$/, "");
    const results = files.map((file) => {
      const fullUrl = `${baseUrl}/api/upload/${file.filename}`;
      return { type: "url" as const, value: fullUrl, name: file.originalname };
    });
    res.json(results);
  } catch (error: any) {
    console.error("Work log upload error:", error);
    res.status(500).json({ message: "Failed to upload file" });
  }
});

// Upload multiple files
router.post("/multiple", authenticateToken, upload.array("files", 10), (req, res) => {
  try {
    if (!req.files || (req.files as Express.Multer.File[]).length === 0) {
      return res.status(400).json({ message: "No files uploaded" });
    }

    const files = req.files as Express.Multer.File[];
    const baseUrl = (process.env.BACKEND_URL || process.env.API_URL || `${req.protocol}://${req.get("host")}`).replace(/\/$/, "");
    const results = files.map((file) => {
      let fileType: "image" | "video" = "image";
      if (file.mimetype.startsWith("video/")) {
        fileType = "video";
      }
      const fullUrl = `${baseUrl}/api/upload/${file.filename}`;
      return {
        type: fileType,
        value: fullUrl,
        name: file.originalname,
      };
    });

    res.json(results);
  } catch (error: any) {
    console.error("Upload error:", error);
    res.status(500).json({ message: "Failed to upload files" });
  }
});

// Serve uploaded files
router.get("/:filename", (req, res) => {
  const filename = req.params.filename;
  const filePath = path.join(uploadsDir, filename);

  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ message: "File not found" });
  }

  res.sendFile(filePath);
});

export default router;

