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
    console.error('[GA4] Failed to fetch top events:', error);
    return [];
  }
}

