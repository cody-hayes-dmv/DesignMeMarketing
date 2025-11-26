import { google } from 'googleapis';
import { prisma } from './prisma.js';

/**
 * Get OAuth2 client for GA4
 */
function getOAuth2Client() {
  const clientId = process.env.GA4_CLIENT_ID;
  const clientSecret = process.env.GA4_CLIENT_SECRET;
  const redirectUri = process.env.GA4_REDIRECT_URI || 'http://localhost:5000/api/clients/ga4/callback';

  if (!clientId || !clientSecret) {
    const errorMsg = 'GA4 credentials not configured. Please set GA4_CLIENT_ID and GA4_CLIENT_SECRET environment variables in server/.env file.\n\n' +
      'Required variables:\n' +
      '  GA4_CLIENT_ID=your_client_id.apps.googleusercontent.com\n' +
      '  GA4_CLIENT_SECRET=your_client_secret\n' +
      '  GA4_REDIRECT_URI=http://localhost:5000/api/clients/ga4/callback\n\n' +
      'See FIX_OAUTH_ERROR.md for setup instructions.';
    throw new Error(errorMsg);
  }

  return new google.auth.OAuth2(clientId, clientSecret, redirectUri);
}

/**
 * Get GA4 authorization URL for OAuth flow
 */
export function getGA4AuthUrl(clientId: string): string {
  const oauth2Client = getOAuth2Client();
  const scopes = [
    'https://www.googleapis.com/auth/analytics.readonly',
    'https://www.googleapis.com/auth/userinfo.email', // Required to get user email
  ];

  const redirectUri = process.env.GA4_REDIRECT_URI || `${process.env.BACKEND_URL || 'http://localhost:5000'}/api/clients/ga4/callback`;

  return oauth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: scopes,
    prompt: 'consent', // Force consent to get refresh token
    state: clientId,
    redirect_uri: redirectUri,
  });
}

/**
 * Exchange authorization code for tokens
 */
export async function exchangeCodeForTokens(code: string): Promise<{
  accessToken: string;
  refreshToken: string;
  email?: string;
}> {
  const oauth2Client = getOAuth2Client();
  const { tokens } = await oauth2Client.getToken(code);
  
  if (!tokens.access_token || !tokens.refresh_token) {
    throw new Error('Failed to get access and refresh tokens from Google');
  }

  // Try to get user email (optional - don't fail if this doesn't work)
  let email: string | undefined;
  try {
    oauth2Client.setCredentials(tokens);
    const oauth2 = google.oauth2({ version: 'v2', auth: oauth2Client });
    const userInfo = await oauth2.userinfo.get();
    email = userInfo.data.email || undefined;
  } catch (emailError) {
    console.warn('Could not fetch user email (non-critical):', emailError);
    // Continue without email - the important thing is we have the tokens
  }

  return {
    accessToken: tokens.access_token,
    refreshToken: tokens.refresh_token,
    email,
  };
}

/**
 * Refresh access token using refresh token
 */
export async function refreshAccessToken(refreshToken: string): Promise<string> {
  const oauth2Client = getOAuth2Client();
  oauth2Client.setCredentials({ refresh_token: refreshToken });

  const accessTokenResponse = await oauth2Client.getAccessToken();
  const newAccessToken = accessTokenResponse?.token;

  if (!newAccessToken) {
    throw new Error('Failed to refresh access token');
  }

  return newAccessToken;
}

/**
 * Get analytics client with valid access token
 */
async function getAnalyticsClient(clientId: string) {
  const client = await prisma.client.findUnique({
    where: { id: clientId },
    select: {
      ga4AccessToken: true,
      ga4RefreshToken: true,
      ga4PropertyId: true,
    },
  });

  if (!client) {
    throw new Error('Client not found');
  }

  if (!client.ga4RefreshToken) {
    throw new Error('GA4 not connected for this client');
  }

  let accessToken = client.ga4AccessToken;

  // Refresh token if needed
  if (!accessToken && client.ga4RefreshToken) {
    try {
      accessToken = await refreshAccessToken(client.ga4RefreshToken);
      // Update stored access token
      await prisma.client.update({
        where: { id: clientId },
        data: { ga4AccessToken: accessToken },
      });
    } catch (error) {
      console.error('Failed to refresh GA4 token:', error);
      throw new Error('GA4 token expired. Please reconnect GA4.');
    }
  }

  const oauth2Client = getOAuth2Client();
  oauth2Client.setCredentials({
    access_token: accessToken,
    refresh_token: client.ga4RefreshToken,
  });

  return google.analyticsdata({ version: 'v1', auth: oauth2Client });
}

/**
 * Fetch real traffic data from GA4
 */
type TrendPoint = {
  date: string;
  value: number;
};

export async function fetchGA4TrafficData(
  clientId: string,
  startDate: Date,
  endDate: Date
): Promise<{
  totalSessions: number;
  organicSessions: number;
  directSessions: number;
  referralSessions: number;
  paidSessions: number;
  bounceRate: number;
  avgSessionDuration: number;
  pagesPerSession: number;
  conversions: number;
  conversionRate: number;
  totalUsers: number;
  firstTimeVisitors: number;
  engagedVisitors: number;
  newUsersTrend: TrendPoint[];
  totalUsersTrend: TrendPoint[];
}> {
  const client = await prisma.client.findUnique({
    where: { id: clientId },
    select: { ga4PropertyId: true },
  });

  if (!client?.ga4PropertyId) {
    throw new Error('GA4 property not configured for this client');
  }

  const analytics = await getAnalyticsClient(clientId);
  // Ensure property ID has the 'properties/' prefix
  const propertyId = client.ga4PropertyId.startsWith('properties/') 
    ? client.ga4PropertyId 
    : `properties/${client.ga4PropertyId}`;

  // Format dates for GA4 API (YYYY-MM-DD)
  const startDateStr = startDate.toISOString().split('T')[0];
  const endDateStr = endDate.toISOString().split('T')[0];

  // Run multiple requests in parallel for better performance
  const [sessionsData, usersData, engagementData, conversionsData, trendData] = await Promise.all([
    // Sessions by channel
    analytics.properties.runReport({
      property: propertyId,
      requestBody: {
        dateRanges: [
          {
            startDate: startDateStr,
            endDate: endDateStr,
          },
        ],
        dimensions: [{ name: 'sessionDefaultChannelGroup' }],
        metrics: [{ name: 'sessions' }],
      },
    }),
    // Total and new users
    analytics.properties.runReport({
      property: propertyId,
      requestBody: {
        dateRanges: [
          {
            startDate: startDateStr,
            endDate: endDateStr,
          },
        ],
        metrics: [
          { name: 'totalUsers' },
          { name: 'newUsers' },
        ],
      },
    }),
    // Engagement metrics
    analytics.properties.runReport({
      property: propertyId,
      requestBody: {
        dateRanges: [
          {
            startDate: startDateStr,
            endDate: endDateStr,
          },
        ],
        metrics: [
          { name: 'bounceRate' },
          { name: 'averageSessionDuration' },
          { name: 'screenPageViewsPerSession' },
          { name: 'engagedSessions' },
        ],
      },
    }),
    // Conversions
    analytics.properties.runReport({
      property: propertyId,
      requestBody: {
        dateRanges: [
          {
            startDate: startDateStr,
            endDate: endDateStr,
          },
        ],
        metrics: [
          { name: 'conversions' },
          { name: 'conversionRate' },
        ],
      },
    }),
    // Trend data (daily new users + total users)
    analytics.properties.runReport({
      property: propertyId,
      requestBody: {
        dateRanges: [
          {
            startDate: startDateStr,
            endDate: endDateStr,
          },
        ],
        dimensions: [{ name: 'date' }],
        metrics: [
          { name: 'newUsers' },
          { name: 'totalUsers' },
        ],
        orderBys: [
          {
            dimension: { dimensionName: 'date' },
          },
        ],
      },
    }),
  ]);

  // Parse sessions by channel
  let totalSessions = 0;
  let organicSessions = 0;
  let directSessions = 0;
  let referralSessions = 0;
  let paidSessions = 0;

  if (sessionsData.data.rows) {
    for (const row of sessionsData.data.rows) {
      const channel = row.dimensionValues?.[0]?.value || '';
      const sessions = parseInt(row.metricValues?.[0]?.value || '0', 10);
      totalSessions += sessions;

      const channelLower = channel.toLowerCase();
      if (channelLower.includes('organic') || channelLower.includes('search')) {
        organicSessions += sessions;
      } else if (channelLower.includes('direct')) {
        directSessions += sessions;
      } else if (channelLower.includes('referral') || channelLower.includes('social')) {
        referralSessions += sessions;
      } else if (channelLower.includes('paid') || channelLower.includes('cpc') || channelLower.includes('ppc')) {
        paidSessions += sessions;
      }
    }
  }

  // Parse total users
  const totalUsers = parseInt(
    usersData.data.rows?.[0]?.metricValues?.[0]?.value || '0',
    10
  );
  const firstTimeVisitors = parseInt(
    usersData.data.rows?.[0]?.metricValues?.[1]?.value || '0',
    10
  );

  // Parse engagement metrics
  const bounceRate = parseFloat(
    engagementData.data.rows?.[0]?.metricValues?.[0]?.value || '0'
  );
  const avgSessionDuration = parseFloat(
    engagementData.data.rows?.[0]?.metricValues?.[1]?.value || '0'
  );
  const pagesPerSession = parseFloat(
    engagementData.data.rows?.[0]?.metricValues?.[2]?.value || '0'
  );
  const engagedVisitors = parseInt(
    engagementData.data.rows?.[0]?.metricValues?.[3]?.value || '0',
    10
  );

  // Parse conversions
  const conversions = parseInt(
    conversionsData.data.rows?.[0]?.metricValues?.[0]?.value || '0',
    10
  );
  const conversionRate = parseFloat(
    conversionsData.data.rows?.[0]?.metricValues?.[1]?.value || '0'
  );

  const newUsersTrend: TrendPoint[] = [];
  const totalUsersTrend: TrendPoint[] = [];

  if (trendData.data.rows) {
    for (const row of trendData.data.rows) {
      const dateValue = row.dimensionValues?.[0]?.value || '';
      const formattedDate =
        dateValue && dateValue.length === 8
          ? `${dateValue.substring(0, 4)}-${dateValue.substring(4, 6)}-${dateValue.substring(6, 8)}`
          : dateValue;
      const newUsersPoint = parseInt(row.metricValues?.[0]?.value || '0', 10);
      const totalUsersPoint = parseInt(row.metricValues?.[1]?.value || '0', 10);

      newUsersTrend.push({
        date: formattedDate,
        value: newUsersPoint,
      });

      totalUsersTrend.push({
        date: formattedDate,
        value: totalUsersPoint,
      });
    }
  }

  return {
    totalSessions,
    organicSessions,
    directSessions,
    referralSessions,
    paidSessions,
    totalUsers,
    bounceRate,
    avgSessionDuration,
    pagesPerSession,
    conversions,
    conversionRate,
    firstTimeVisitors,
    engagedVisitors,
    newUsersTrend,
    totalUsersTrend,
  };
}

/**
 * Check if GA4 is connected for a client
 */
export async function isGA4Connected(clientId: string): Promise<boolean> {
  const client = await prisma.client.findUnique({
    where: { id: clientId },
    select: {
      ga4AccessToken: true,
      ga4RefreshToken: true,
      ga4PropertyId: true,
      ga4ConnectedAt: true,
    },
  });

  return !!(
    client?.ga4RefreshToken &&
    client?.ga4PropertyId &&
    client?.ga4ConnectedAt
  );
}

