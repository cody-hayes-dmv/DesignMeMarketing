import express from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { sendEmail } from "../lib/email.js";
import { authenticateToken } from "../middleware/auth.js";

const router = express.Router();

const registerSchema = z.object({
  email: z.string().email(),
  password: z.string().min(6),
  name: z.string().min(1),
});

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string(),
});

// Register
router.post("/register", async (req, res) => {
  try {
    const { email, password, name } = registerSchema.parse(req.body);

    // Check if user exists
    const existingUser = await prisma.user.findUnique({
      where: { email },
    });

    if (existingUser) {
      return res.status(400).json({ message: "User already exists" });
    }

    // Hash password
    const passwordHash = await bcrypt.hash(password, 12);

    // Create user
    const user = await prisma.user.create({
      data: {
        email,
        name,
        passwordHash,
        role: "AGENCY",
      },
    });

    // Create verification token
    const verificationToken = jwt.sign(
      { userId: user.id },
      process.env.JWT_SECRET!,
      { expiresIn: "24h" }
    );

    await prisma.token.create({
      data: {
        type: "EMAIL_VERIFY",
        email: user.email,
        token: verificationToken,
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000), // 24 hours
        userId: user.id,
      },
    });

    // Send verification email
    // await sendEmail({
    //   to: email,
    //   subject: "Verify your email - YourSEODashboard",
    //   html: `
    //     <h1>Welcome to YourSEODashboard!</h1>
    //     <p>Please verify your email by clicking the link below:</p>
    //     <a href="${process.env.FRONTEND_URL}/verify?token=${verificationToken}">Verify Email</a>
    //   `,
    // });

    res.status(201).json({
      message:
        "User created successfully. Please check your email to verify your account.",
    });
  } catch (error) {
    console.error("Registration error:", error);
    res.status(400).json({ message: "Registration failed" });
  }
});

// Login
router.post("/login", async (req, res) => {
  try {
    const { email, password } = loginSchema.parse(req.body);

    // Find user
    const user = await prisma.user.findUnique({
      where: { email },
      include: {
        memberships: {
          include: {
            agency: true,
          },
        },
      },
    });

    if (!user || !user.passwordHash) {
      return res.status(401).json({ message: "Invalid credentials" });
    }

    // Check password
    const isValidPassword = await bcrypt.compare(password, user.passwordHash);
    if (!isValidPassword) {
      return res.status(401).json({ message: "Invalid credentials" });
    }

    // Check if email is verified
    if (!user.verified) {
      return res
        .status(401)
        .json({ message: "Please verify your email before logging in" });
    }

    // Generate JWT
    const token = jwt.sign(
      { userId: user.id, email: user.email, role: user.role },
      process.env.JWT_SECRET!,
      { expiresIn: "7d" }
    );

    res.json({
      token,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
        verified: user.verified,
        invited: user.invited,
      },
    });
  } catch (error) {
    console.error("Login error:", error);
    res.status(400).json({ message: "Login failed" });
  }
});

// Get current user
router.get("/me", authenticateToken, async (req, res) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.user.userId },
      include: {
        memberships: {
          include: {
            agency: true,
          },
        },
      },
    });

    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    res.json({
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      verified: user.verified,
      invited: user.invited,
    });
  } catch (error) {
    console.error("Get user error:", error);
    res.status(500).json({ message: "Internal server error" });
  }
});

// Verify email
router.post("/verify", async (req, res) => {
  try {
    const { token } = req.body;

    // Find and validate token
    const tokenRecord = await prisma.token.findUnique({
      where: { token },
      include: { user: true },
    });

    if (
      !tokenRecord ||
      tokenRecord.usedAt ||
      tokenRecord.expiresAt < new Date()
    ) {
      return res.status(400).json({ message: "Invalid or expired token" });
    }

    // Update user as verified
    await prisma.user.update({
      where: { id: tokenRecord.userId! },
      data: { verified: true },
    });

    // Mark token as used
    await prisma.token.update({
      where: { id: tokenRecord.id },
      data: { usedAt: new Date() },
    });

    res.json({ message: "Email verified successfully" });
  } catch (error) {
    console.error("Verification error:", error);
    res.status(500).json({ message: "Verification failed" });
  }
});

// Get workers for task assignment
router.get("/workers", authenticateToken, async (req, res) => {
  try {
    const user = req.user;
    
    if (user.role !== "AGENCY" && user.role !== "ADMIN" && user.role !== "SUPER_ADMIN") {
      return res.status(403).json({ message: "Access denied" });
    }

    let workers;
    if (user.role === "SUPER_ADMIN") {
      // Super admin can see all workers
      workers = await prisma.user.findMany({
        where: { role: "WORKER" },
        select: { id: true, name: true, email: true }
      });
    } else {
      // Get workers from user's agency
      const userAgency = await prisma.userAgency.findFirst({
        where: { userId: user.userId },
        select: { agencyId: true }
      });
      
      if (!userAgency) {
        return res.status(404).json({ message: "Agency not found" });
      }

      workers = await prisma.user.findMany({
        where: {
          role: "WORKER",
          // agencies: {
          //   some: { agencyId: userAgency.agencyId }
          // }
        },
        select: { id: true, name: true, email: true }
      });
    }

    res.json(workers);
  } catch (error) {
    console.error("Error fetching workers:", error);
    res.status(500).json({ message: "Internal server error" });
  }
});

// Update user profile
const updateProfileSchema = z.object({
  name: z.string().min(1).optional(),
  email: z.string().email().optional(),
});

router.put("/profile", authenticateToken, async (req, res) => {
  try {
    const updateData = updateProfileSchema.parse(req.body);
    const userId = req.user.userId;

    // Check if email is being changed and if it's already taken
    if (updateData.email) {
      const existingUser = await prisma.user.findUnique({
        where: { email: updateData.email },
      });

      if (existingUser && existingUser.id !== userId) {
        return res.status(400).json({ message: "Email already in use" });
      }
    }

    const updatedUser = await prisma.user.update({
      where: { id: userId },
      data: updateData,
    });

    res.json({
      id: updatedUser.id,
      email: updatedUser.email,
      name: updatedUser.name,
      role: updatedUser.role,
      verified: updatedUser.verified,
      invited: updatedUser.invited,
    });
  } catch (error: any) {
    if (error.name === "ZodError") {
      return res.status(400).json({ message: "Invalid input", errors: error.errors });
    }
    console.error("Update profile error:", error);
    res.status(500).json({ message: "Internal server error" });
  }
});

// Change password
const changePasswordSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(6),
});

router.put("/password", authenticateToken, async (req, res) => {
  try {
    const { currentPassword, newPassword } = changePasswordSchema.parse(req.body);
    const userId = req.user.userId;

    const user = await prisma.user.findUnique({
      where: { id: userId },
    });

    if (!user || !user.passwordHash) {
      return res.status(404).json({ message: "User not found or has no password set" });
    }

    // Verify current password
    const isValidPassword = await bcrypt.compare(currentPassword, user.passwordHash);
    if (!isValidPassword) {
      return res.status(401).json({ message: "Current password is incorrect" });
    }

    // Hash new password
    const newPasswordHash = await bcrypt.hash(newPassword, 12);

    // Update password
    await prisma.user.update({
      where: { id: userId },
      data: { passwordHash: newPasswordHash },
    });

    res.json({ message: "Password updated successfully" });
  } catch (error: any) {
    if (error.name === "ZodError") {
      return res.status(400).json({ message: "Invalid input", errors: error.errors });
    }
    console.error("Change password error:", error);
    res.status(500).json({ message: "Internal server error" });
  }
});

export default router;
