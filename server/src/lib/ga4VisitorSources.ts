import { prisma } from './prisma.js';
import { getAnalyticsClient } from './ga4.js';

/**
 * Fetch visitor sources from GA4 by sessionManualSource dimension
 * Based on Google Analytics Data API reference
 */
export async function fetchGA4VisitorSources(
  clientId: string,
  startDate: Date,
  endDate: Date,
  limit: number = 10
): Promise<Array<{
  source: string;
  users: number;
}>> {
  const GA4_VISITOR_SOURCES_TIMEOUT_MS = 15000;
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
          name: 'sessionManualSource',
        },
      ],
      metrics: [
        {
          name: 'activeUsers',
        },
      ],
      orderBys: [
        {
          metric: {
            metricName: 'activeUsers',
          },
          desc: true,
        },
      ],
      limit: limit,
    });
    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error("GA4 visitor sources request timed out")), GA4_VISITOR_SOURCES_TIMEOUT_MS);
    });
    const [response] = await Promise.race([requestPromise, timeoutPromise]);

    if (!response.rows || response.rows.length === 0) {
      return [];
    }

    const sources = response.rows.map((row: any) => {
      const source = row.dimensionValues?.[0]?.value || '(not set)';
      const users = parseInt(row.metricValues?.[0]?.value || '0', 10);
      return {
        source: source === '' ? '(not set)' : source,
        users: users,
      };
    }).filter((item: { source: string; users: number }) => item.source && item.users > 0);

    return sources;
  } catch (error: any) {
    // Avoid noisy logs for expected GA4 disconnects (token revoked, not connected, etc.)
    const msg = String(error?.message || "");
    if (!msg.includes("GA4")) {
      console.warn("[GA4] Failed to fetch visitor sources:", msg);
    }
    return [];
  }
}

