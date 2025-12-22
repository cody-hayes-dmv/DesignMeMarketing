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
    const [response] = await analytics.runReport({
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
    console.error('[GA4] Failed to fetch visitor sources:', error);
    return [];
  }
}

