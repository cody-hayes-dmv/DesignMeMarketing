import express from "express";
import type Stripe from "stripe";
import { authenticateToken } from "../middleware/auth.js";
import {
  getStripe,
  isStripeConfigured,
  categorizeProduct,
  CATEGORY_LABELS,
  type MrrCategory,
} from "../lib/stripe.js";

const router = express.Router();

// Require AGENCY, ADMIN, or SUPER_ADMIN
const requireFinancialAccess = (req: express.Request, res: express.Response, next: express.NextFunction) => {
  const role = req.user?.role;
  if (!["AGENCY", "ADMIN", "SUPER_ADMIN"].includes(role || "")) {
    return res.status(403).json({ message: "Access denied" });
  }
  next();
};

interface MrrSegment {
  category: string;
  label: string;
  mrr: number;
  count: number;
  color: string;
  accounts: Array<{ customerId: string; customerEmail: string; mrr: number; productName: string }>;
}

const CATEGORY_COLORS: Record<string, string> = {
  platform_solo: "#6366f1",
  platform_starter: "#8b5cf6",
  platform_growth: "#a855f7",
  platform_pro: "#d946ef",
  platform_enterprise: "#ec4899",
  managed_foundation: "#0ea5e9",
  managed_growth: "#06b6d4",
  managed_domination: "#14b8a6",
  addon_slots: "#22c55e",
  addon_mappacks: "#84cc16",
  addon_creditpacks: "#eab308",
  other: "#94a3b8",
};

function getAmountInDollars(amount: number): number {
  return amount / 100;
}

function normalizeToMonthly(amount: number, interval: "day" | "week" | "month" | "year"): number {
  switch (interval) {
    case "day":
      return amount * 30;
    case "week":
      return amount * (52 / 12);
    case "month":
      return amount;
    case "year":
      return amount / 12;
    default:
      return amount;
  }
}

router.get("/mrr-breakdown", authenticateToken, requireFinancialAccess, async (req, res) => {
  try {
    const stripe = getStripe();
    if (!stripe || !isStripeConfigured()) {
      return res.json({
        totalMrr: 0,
        segments: [],
        configured: false,
        message: "Stripe is not configured. Set STRIPE_SECRET_KEY",
      });
    }

    const segmentsMap = new Map<string, MrrSegment>();

    let hasMore = true;
    let startingAfter: string | undefined;
    while (hasMore) {
      const list = await stripe.subscriptions.list({
        status: "active",
        expand: ["data.items.data.price", "data.customer"],
        limit: 100,
        ...(startingAfter && { starting_after: startingAfter }),
      });
      for (const sub of list.data) {
        const customer = sub.customer as { id?: string; email?: string };
        const customerId = typeof customer === "string" ? customer : customer?.id || "";
        const customerEmail =
          typeof customer === "object" && customer && "email" in customer
            ? (customer.email as string) || ""
            : "";

        for (const item of sub.items.data) {
        const price = item.price;
        if (!price || !price.recurring) continue;

        const product =
          typeof price.product === "object" ? price.product : await stripe.products.retrieve(price.product as string);
        const productName =
          product && "name" in product && typeof product.name === "string" ? product.name : "Unknown";
        const category = categorizeProduct(
          product && typeof product === "object" && "deleted" in product
            ? productName
            : (product as Stripe.Product) || productName
        );
        const interval = price.recurring.interval;
        const unitAmount = price.unit_amount || 0;
        const qty = item.quantity || 1;
        const monthlyAmount = normalizeToMonthly(
          getAmountInDollars(unitAmount * qty),
          interval as "day" | "week" | "month" | "year"
        );

        const key = category;
        const label = CATEGORY_LABELS[category as MrrCategory] || category;
        const color = CATEGORY_COLORS[key] || "#94a3b8";

        let seg = segmentsMap.get(key);
        if (!seg) {
          seg = { category: key, label, mrr: 0, count: 0, color, accounts: [] };
          segmentsMap.set(key, seg);
        }
        seg.mrr += monthlyAmount;
        seg.count += 1;
        seg.accounts.push({
          customerId,
          customerEmail,
          mrr: monthlyAmount,
          productName,
        });
        }
      }
      hasMore = list.has_more && list.data.length > 0;
      if (hasMore) startingAfter = list.data[list.data.length - 1].id;
    }

    const segments = Array.from(segmentsMap.values())
      .filter((s) => s.mrr > 0)
      .sort((a, b) => b.mrr - a.mrr);

    const totalMrr = segments.reduce((sum, s) => sum + s.mrr, 0);

    res.json({
      totalMrr,
      segments,
      configured: true,
    });
  } catch (err: any) {
    console.error("[financial] mrr-breakdown error:", err);
    res.status(500).json({
      message: err?.message || "Failed to fetch MRR breakdown",
      totalMrr: 0,
      segments: [],
      configured: true,
    });
  }
});

router.get("/subscription-activity", authenticateToken, requireFinancialAccess, async (req, res) => {
  try {
    const stripe = getStripe();
    if (!stripe || !isStripeConfigured()) {
      return res.json({
        configured: false,
        dailyData: [],
        newMrrAdded: 0,
        churnedMrr: 0,
        netChange: 0,
        message: "Stripe is not configured.",
      });
    }

    const thirtyDaysAgo = Math.floor(Date.now() / 1000) - 30 * 24 * 60 * 60;
    const dailyNewMrr: Record<string, number> = {};
    const dailyChurnedMrr: Record<string, number> = {};
    let totalNewMrr = 0;
    let totalChurnedMrr = 0;

    // Build date keys for last 30 days
    for (let i = 29; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const key = d.toISOString().slice(0, 10);
      dailyNewMrr[key] = 0;
      dailyChurnedMrr[key] = 0;
    }

    // Subscription created events
    let createdHasMore = true;
    let createdStartingAfter: string | undefined;
    while (createdHasMore) {
      const createdResp = await stripe.events.list({
        type: "customer.subscription.created",
        created: { gte: thirtyDaysAgo },
        limit: 100,
        ...(createdStartingAfter && { starting_after: createdStartingAfter }),
      });
      for (const ev of createdResp.data) {
        const sub = ev.data?.object as any;
        if (!sub?.id) continue;
        const expanded = await stripe.subscriptions.retrieve(sub.id, {
          expand: ["items.data.price.product"],
        });
        let mrr = 0;
        for (const item of expanded.items.data) {
          const price = item.price;
          if (!price?.recurring) continue;
          const unitAmount = (price.unit_amount || 0) / 100;
          const qty = item.quantity || 1;
          mrr += normalizeToMonthly(unitAmount * qty, price.recurring.interval as any);
        }
        const dateKey = new Date((ev.created || 0) * 1000).toISOString().slice(0, 10);
        if (dailyNewMrr[dateKey] !== undefined) {
          dailyNewMrr[dateKey] += mrr;
          totalNewMrr += mrr;
        }
      }
      createdHasMore = createdResp.has_more;
      if (createdHasMore && createdResp.data.length > 0) {
        createdStartingAfter = createdResp.data[createdResp.data.length - 1].id;
      } else break;
    }

    // Subscription updated (upgrades - simplified: treat as new MRR when plan changes)
    let updatedHasMore = true;
    let updatedStartingAfter: string | undefined;
    while (updatedHasMore) {
      const updatedResp = await stripe.events.list({
        type: "customer.subscription.updated",
        created: { gte: thirtyDaysAgo },
        limit: 100,
        ...(updatedStartingAfter && { starting_after: updatedStartingAfter }),
      });
      for (const ev of updatedResp.data) {
        const obj = ev.data?.object as any;
        const prev = (ev.data?.previous_attributes as any)?.items;
        if (!prev) continue; // no plan change
        const prevItems = prev?.data || [];
        const currItems = obj?.items?.data || [];
        let prevMrr = 0;
        let currMrr = 0;
        for (const it of prevItems) {
          const price = it.price;
          if (!price?.recurring) continue;
          prevMrr += normalizeToMonthly(
            ((price.unit_amount || 0) / 100) * (it.quantity || 1),
            price.recurring.interval
          );
        }
        for (const it of currItems) {
          const price = it.price;
          if (!price?.recurring) continue;
          currMrr += normalizeToMonthly(
            ((price.unit_amount || 0) / 100) * (it.quantity || 1),
            price.recurring.interval
          );
        }
        const delta = currMrr - prevMrr;
        const dateKey = new Date((ev.created || 0) * 1000).toISOString().slice(0, 10);
        if (dailyNewMrr[dateKey] !== undefined) {
          if (delta > 0) {
            dailyNewMrr[dateKey] += delta;
            totalNewMrr += delta;
          } else if (delta < 0) {
            dailyChurnedMrr[dateKey] += Math.abs(delta);
            totalChurnedMrr += Math.abs(delta);
          }
        }
      }
      updatedHasMore = updatedResp.has_more;
      if (updatedHasMore && updatedResp.data.length > 0) {
        updatedStartingAfter = updatedResp.data[updatedResp.data.length - 1].id;
      } else break;
    }

    // Subscription deleted / canceled
    let deletedHasMore = true;
    let deletedStartingAfter: string | undefined;
    while (deletedHasMore) {
      const deletedResp = await stripe.events.list({
        type: "customer.subscription.deleted",
        created: { gte: thirtyDaysAgo },
        limit: 100,
        ...(deletedStartingAfter && { starting_after: deletedStartingAfter }),
      });
      for (const ev of deletedResp.data) {
        const sub = ev.data?.object as any;
        if (!sub?.items?.data) continue;
        let mrr = 0;
        for (const it of sub.items.data) {
          const price = it.price;
          if (!price?.recurring) continue;
          mrr += normalizeToMonthly(
            ((price.unit_amount || 0) / 100) * (it.quantity || 1),
            price.recurring.interval
          );
        }
        const dateKey = new Date((ev.created || 0) * 1000).toISOString().slice(0, 10);
        if (dailyChurnedMrr[dateKey] !== undefined) {
          dailyChurnedMrr[dateKey] += mrr;
          totalChurnedMrr += mrr;
        }
      }
      deletedHasMore = deletedResp.has_more;
      if (deletedHasMore && deletedResp.data.length > 0) {
        deletedStartingAfter = deletedResp.data[deletedResp.data.length - 1].id;
      } else break;
    }

    const sortedDates = Object.keys(dailyNewMrr).sort();
    const dailyData = sortedDates.map((date) => ({
      date,
      newMrr: Math.round(dailyNewMrr[date] * 100) / 100,
      churnedMrr: Math.round(dailyChurnedMrr[date] * 100) / 100,
    }));

    res.json({
      configured: true,
      dailyData,
      newMrrAdded: Math.round(totalNewMrr * 100) / 100,
      churnedMrr: Math.round(totalChurnedMrr * 100) / 100,
      netChange: Math.round((totalNewMrr - totalChurnedMrr) * 100) / 100,
    });
  } catch (err: any) {
    console.error("[financial] subscription-activity error:", err);
    res.status(500).json({
      message: err?.message || "Failed to fetch subscription activity",
      configured: true,
      dailyData: [],
      newMrrAdded: 0,
      churnedMrr: 0,
      netChange: 0,
    });
  }
});

export default router;
