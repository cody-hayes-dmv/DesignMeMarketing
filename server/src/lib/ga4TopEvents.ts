import { prisma } from './prisma.js';
import { getAnalyticsClient } from './ga4.js';

/**
 * Fetch top events from GA4 by event count
 * Based on Google Analytics Data API reference
 */
export async function fetchGA4TopEvents(
  clientId: string,
  startDate: Date,
  endDate: Date,
  limit: number = 10
): Promise<Array<{
  name: string;
  count: number;
}>> {
  const GA4_TOP_EVENTS_TIMEOUT_MS = 15000;
  const client = await prisma.client.findUnique({
    where: { id: clientId },
    select: { ga4PropertyId: true },
  });

  if (!client?.ga4PropertyId) {
    return [];
  }

  const analytics = await getAnalyticsClient(clientId);
  const propertyId = client.ga4PropertyId.startsWith('properties/') 
    ? client.ga4PropertyId 
    : `properties/${client.ga4PropertyId}`;

  const startDateStr = startDate.toISOString().split('T')[0];
  const endDateStr = endDate.toISOString().split('T')[0];

  try {
    const requestPromise: Promise<[any, any?, any?]> = analytics.runReport({
      property: propertyId,
      dateRanges: [
        {
          startDate: startDateStr,
          endDate: endDateStr,
        },
      ],
      dimensions: [
        {
          name: 'eventName',
        },
      ],
      metrics: [
        {
          name: 'eventCount',
        },
      ],
      orderBys: [
        {
          metric: {
            metricName: 'eventCount',
          },
          desc: true,
        },
      ],
      limit: limit,
    });
    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error("GA4 top events request timed out")), GA4_TOP_EVENTS_TIMEOUT_MS);
    });
    const [response] = await Promise.race([requestPromise, timeoutPromise]);

    if (!response.rows || response.rows.length === 0) {
      return [];
    }

    const events = response.rows.map((row: any) => {
      const eventName = row.dimensionValues?.[0]?.value || '';
      const count = parseInt(row.metricValues?.[0]?.value || '0', 10);
      return {
        name: eventName,
        count: count,
      };
    }).filter((event: { name: string; count: number }) => event.name && event.count > 0);

    return events;
  } catch (error: any) {
    // Avoid noisy logs for expected GA4 disconnects (token revoked, not connected, etc.)
    const msg = String(error?.message || "");
    if (!msg.includes("GA4")) {
      console.warn("[GA4] Failed to fetch top events:", msg);
    }
    return [];
  }
}

/**
 * Fetch top Key Events (Conversions) from GA4 by conversions metric.
 * In GA4 Data API, the `conversions` metric returns counts only for events marked as key events.
 */
export async function fetchGA4TopKeyEvents(
  clientId: string,
  startDate: Date,
  endDate: Date,
  limit: number = 10
): Promise<Array<{
  name: string;
  count: number;
}>> {
  const GA4_TOP_KEY_EVENTS_TIMEOUT_MS = 15000;
  const client = await prisma.client.findUnique({
    where: { id: clientId },
    select: { ga4PropertyId: true },
  });

  if (!client?.ga4PropertyId) {
    return [];
  }

  const analytics = await getAnalyticsClient(clientId);
  const propertyId = client.ga4PropertyId.startsWith("properties/")
    ? client.ga4PropertyId
    : `properties/${client.ga4PropertyId}`;

  const startDateStr = startDate.toISOString().split("T")[0];
  const endDateStr = endDate.toISOString().split("T")[0];

  try {
    const requestPromise: Promise<[any, any?, any?]> = analytics.runReport({
      property: propertyId,
      dateRanges: [
        {
          startDate: startDateStr,
          endDate: endDateStr,
        },
      ],
      dimensions: [{ name: "eventName" }],
      metrics: [{ name: "conversions" }],
      orderBys: [
        {
          metric: { metricName: "conversions" },
          desc: true,
        },
      ],
      limit: limit,
    });
    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error("GA4 top key events request timed out")), GA4_TOP_KEY_EVENTS_TIMEOUT_MS);
    });
    const [response] = await Promise.race([requestPromise, timeoutPromise]);

    if (!response.rows || response.rows.length === 0) {
      return [];
    }

    const events = response.rows
      .map((row: any) => {
        const eventName = row.dimensionValues?.[0]?.value || "";
        const count = parseInt(row.metricValues?.[0]?.value || "0", 10);
        return { name: eventName, count };
      })
      .filter((event: { name: string; count: number }) => event.name && event.count > 0);

    return events;
  } catch (error: any) {
    const msg = String(error?.message || "");
    if (!msg.includes("GA4")) {
      console.warn("[GA4] Failed to fetch top key events:", msg);
    }
    return [];
  }
}

