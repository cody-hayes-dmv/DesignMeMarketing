import { google } from 'googleapis';
import { BetaAnalyticsDataClient } from '@google-analytics/data';
import { GoogleAuth } from 'google-auth-library';
import { prisma } from './prisma.js';

const GA4_REVOKED_TOKEN_TTL_MS = 10 * 60 * 1000; // 10 minutes
const ga4RevokedClientCache = new Map<string, number>();

function isGa4InvalidGrant(error: any): boolean {
  const msg = String(error?.message || "");
  const respErr = String(error?.response?.data?.error || "");
  const respDesc = String(error?.response?.data?.error_description || "");
  return (
    msg.includes("invalid_grant") ||
    respErr === "invalid_grant" ||
    respDesc.toLowerCase().includes("expired") ||
    respDesc.toLowerCase().includes("revoked")
  );
}

function isGa4RevokedCached(clientId: string): boolean {
  const ts = ga4RevokedClientCache.get(clientId);
  if (!ts) return false;
  if (Date.now() - ts > GA4_REVOKED_TOKEN_TTL_MS) {
    ga4RevokedClientCache.delete(clientId);
    return false;
  }
  return true;
}

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
    'https://www.googleapis.com/auth/analytics.readonly', // This scope covers both Data API and Admin API (read-only)
    'https://www.googleapis.com/auth/userinfo.email', // Required to get user email
  ];

  const redirectUri = process.env.GA4_REDIRECT_URI || `${process.env.BACKEND_URL || 'http://localhost:5000'}/api/clients/ga4/callback`;

  // Log for debugging
  console.log('[GA4] Generating auth URL with:', {
    clientId: process.env.GA4_CLIENT_ID ? `${process.env.GA4_CLIENT_ID.substring(0, 20)}...` : 'MISSING',
    redirectUri,
    hasClientSecret: !!process.env.GA4_CLIENT_SECRET,
  });

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
  
  // Log for debugging
  const redirectUri = process.env.GA4_REDIRECT_URI || `${process.env.BACKEND_URL || 'http://localhost:5000'}/api/clients/ga4/callback`;
  console.log('[GA4] Exchanging code for tokens with redirect URI:', redirectUri);
  
  let tokens;
  try {
    const tokenResponse = await oauth2Client.getToken(code);
    tokens = tokenResponse.tokens;
    
    if (!tokens.access_token || !tokens.refresh_token) {
      throw new Error('Failed to get access and refresh tokens from Google');
    }
  } catch (error: any) {
    console.error('[GA4] Token exchange failed:', {
      error: error.message,
      code: error.code,
      redirectUri,
      clientId: process.env.GA4_CLIENT_ID ? `${process.env.GA4_CLIENT_ID.substring(0, 20)}...` : 'MISSING',
    });
    throw error;
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
export async function getAnalyticsClient(clientId: string) {
  if (isGa4RevokedCached(clientId)) {
    throw new Error('GA4 token expired or revoked. Please reconnect GA4.');
  }

  const client = await prisma.client.findUnique({
    where: { id: clientId },
    select: {
      ga4AccessToken: true,
      ga4RefreshToken: true,
      ga4PropertyId: true,
      ga4ConnectedAt: true,
    },
  });

  if (!client) {
    throw new Error('Client not found');
  }

  if (!client.ga4RefreshToken) {
    throw new Error('GA4 not connected for this client');
  }

  // IMPORTANT:
  // We don't store token expiry in DB, so relying on getAccessToken() can leave
  // us with a stale access token after some time. Force-refresh every time to
  // keep GA4 requests working reliably.
  let accessToken: string;
  try {
    accessToken = await refreshAccessToken(client.ga4RefreshToken);
    await prisma.client.update({
      where: { id: clientId },
      data: { ga4AccessToken: accessToken },
    });
  } catch (error: any) {
    const invalidGrant = isGa4InvalidGrant(error);
    const errMsg = String(error?.message || "unknown_error");
    const respErr = String(error?.response?.data?.error || "");
    const respDesc = String(error?.response?.data?.error_description || "");

    if (invalidGrant) {
      ga4RevokedClientCache.set(clientId, Date.now());
      console.warn(
        `[GA4] Refresh token invalid_grant for clientId=${clientId}. Marking GA4 disconnected. (${respErr || errMsg}${respDesc ? `: ${respDesc}` : ""})`
      );
      // Disconnect the client so future requests don't keep trying.
      try {
        await prisma.client.update({
          where: { id: clientId },
          data: {
            ga4AccessToken: null,
            ga4RefreshToken: null,
            ga4ConnectedAt: null,
          },
        });
      } catch (disconnectErr: any) {
        console.warn(
          `[GA4] Failed to mark clientId=${clientId} disconnected:`,
          disconnectErr?.message || disconnectErr
        );
      }
      throw new Error('GA4 token expired or revoked. Please reconnect GA4.');
    }

    console.warn(
      `[GA4] Failed to refresh token for clientId=${clientId}: ${respErr || errMsg}${respDesc ? `: ${respDesc}` : ""}`
    );
    throw new Error('GA4 token refresh failed. Please reconnect GA4.');
  }

  const oauth2Client = getOAuth2Client();
  oauth2Client.setCredentials({
    access_token: accessToken,
    refresh_token: client.ga4RefreshToken,
  });

  // Create GoogleAuth instance with OAuth2Client
  // We need to prevent it from trying to load default credentials
  const auth = new GoogleAuth({
    authClient: oauth2Client,
  });
  
  // CRITICAL: Set cachedCredential to prevent getApplicationDefaultAsync from being called
  // This prevents the "Could not load the default credentials" error
  (auth as any).cachedCredential = oauth2Client;
  (auth as any).cachedCredentialPromise = Promise.resolve(oauth2Client);

  // Quick sanity check (keeps errors actionable in logs)
  if (!process.env.GA4_CLIENT_ID || !process.env.GA4_CLIENT_SECRET) {
    throw new Error("GA4 OAuth environment variables missing (GA4_CLIENT_ID / GA4_CLIENT_SECRET).");
  }

  // Create BetaAnalyticsDataClient with authenticated GoogleAuth
  const analyticsDataClient = new BetaAnalyticsDataClient({
    auth: auth,
  });

  console.log(`[GA4] Created analytics client for clientId: ${clientId}, propertyId: ${client.ga4PropertyId}, accessToken: ${accessToken ? 'present' : 'missing'}`);
  
  return analyticsDataClient;
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
  organicSearchEngagedSessions: number;
  bounceRate: number;
  avgSessionDuration: number;
  pagesPerSession: number;
  conversions: number;
  conversionRate: number;
  activeUsers: number;
  totalUsers: number; // Web Visitors (preferred)
  eventCount: number;
  newUsers: number;
  keyEvents: number;
  engagedSessions: number; // Engaged Sessions from GA4 engagedSessions metric
  engagementRate: number; // Engagement rate as decimal (0.63 for 63%)
  newUsersTrend: TrendPoint[];
  activeUsersTrend: TrendPoint[]; // Replaces totalUsersTrend
}> {
  const client = await prisma.client.findUnique({
    where: { id: clientId },
    select: { ga4PropertyId: true },
  });

  if (!client?.ga4PropertyId) {
    throw new Error('GA4 property not configured for this client');
  }

  const analytics = await getAnalyticsClient(clientId);
  // Ensure property ID has the 'properties/' prefix for BetaAnalyticsDataClient
  const propertyId = client.ga4PropertyId.startsWith('properties/') 
    ? client.ga4PropertyId 
    : `properties/${client.ga4PropertyId}`;

  // Format dates for GA4 API (YYYY-MM-DD)
  const startDateStr = startDate.toISOString().split('T')[0];
  const endDateStr = endDate.toISOString().split('T')[0];

  console.log(`[GA4] Fetching data for property ${propertyId} from ${startDateStr} to ${endDateStr}`);
  console.log(`[GA4] Stored property ID: ${client.ga4PropertyId}, Formatted: ${propertyId}`);

  // Run requests with individual error handling to avoid one failure breaking all requests
  let sessionsResponse,
    usersResponse,
    engagementResponse,
    conversionsResponse,
    trendResponse,
    keyEventsResponse,
    engagedSessionsByChannelResponse;
  
  // Helper to safely run a report request
  const safeRunReport = async (requestConfig: any, requestName: string) => {
    try {
      const [response] = await analytics.runReport(requestConfig);
      return response;
    } catch (error: any) {
      console.warn(`[GA4] ${requestName} request failed:`, {
        error: error.message,
        code: error.code,
        propertyId,
      });
      // Return null so other requests can still succeed
      return null;
    }
  };

  try {
    // Run core requests in parallel (these are most important)
    const [sessionsResult, usersResult, engagementResult, trendResult, engagedSessionsByChannelResult] = await Promise.all([
      // Sessions by channel
      safeRunReport(
        {
          property: propertyId,
          dateRanges: [
            {
              startDate: startDateStr,
              endDate: endDateStr,
            },
          ],
          dimensions: [{ name: "sessionDefaultChannelGroup" }],
          metrics: [{ name: "sessions" }],
        },
        "Sessions by channel"
      ),

      // Users + events
      safeRunReport(
        {
          property: propertyId,
          dateRanges: [
            {
              startDate: startDateStr,
              endDate: endDateStr,
            },
          ],
          metrics: [
            { name: "activeUsers" },
            { name: "totalUsers" },
            { name: "newUsers" },
            { name: "eventCount" },
          ],
        },
        "Users and Events"
      ),

      // Engagement metrics
      safeRunReport(
        {
          property: propertyId,
          dateRanges: [
            {
              startDate: startDateStr,
              endDate: endDateStr,
            },
          ],
          metrics: [
            { name: "bounceRate" },
            { name: "averageSessionDuration" },
            { name: "screenPageViewsPerSession" },
            { name: "engagedSessions" }, // Engaged Sessions from GA4
            { name: "engagementRate" }, // Engagement rate as decimal
          ],
        },
        "Engagement"
      ),

      // Trend data (daily new users + active users)
      safeRunReport(
        {
          property: propertyId,
          dateRanges: [
            {
              startDate: startDateStr,
              endDate: endDateStr,
            },
          ],
          dimensions: [{ name: "date" }],
          metrics: [{ name: "newUsers" }, { name: "activeUsers" }],
          orderBys: [
            {
              dimension: { dimensionName: "date" },
            },
          ],
        },
        "Trend data"
      ),

      // Engaged sessions by channel (used for Organic Traffic = Organic Search engaged sessions)
      safeRunReport(
        {
          property: propertyId,
          dateRanges: [
            {
              startDate: startDateStr,
              endDate: endDateStr,
            },
          ],
          dimensions: [{ name: "sessionDefaultChannelGroup" }],
          metrics: [{ name: "engagedSessions" }],
        },
        "Engaged sessions by channel"
      ),
    ]);

    sessionsResponse = sessionsResult;
    usersResponse = usersResult;
    engagementResponse = engagementResult;
    trendResponse = trendResult;
    engagedSessionsByChannelResponse = engagedSessionsByChannelResult;

    // Try conversions separately (this often fails if conversion events aren't configured)
    conversionsResponse = await safeRunReport({
      property: propertyId,
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
    }, 'Conversions');

    // Try to get key events by querying events with eventName dimension
    // The conversions metric will only return values for events marked as key events
    // We'll sum up all conversion values to get total key events
    keyEventsResponse = await safeRunReport({
      property: propertyId,
      dateRanges: [
        {
          startDate: startDateStr,
          endDate: endDateStr,
        },
      ],
      dimensions: [{ name: 'eventName' }],
      metrics: [
        { name: 'conversions' }, // This metric only counts events marked as conversions/key events
      ],
      // Limit to top 50 events to avoid quota issues
      limit: 50,
    }, 'Key Events by eventName');

    // Check if we got at least some data
    if (!sessionsResponse && !usersResponse && !engagementResponse && !trendResponse) {
      throw new Error('All GA4 API requests failed. Please check property ID and permissions.');
    }

  } catch (apiError: any) {
    console.error('[GA4] Critical API error:', {
      error: apiError.message,
      code: apiError.code,
      propertyId,
    });
    
    // More detailed error message
    let errorMessage = `Failed to fetch GA4 data: ${apiError.message || 'Unknown error'}`;
    if (apiError.code === 3 || apiError.message?.includes('INVALID_ARGUMENT')) {
      errorMessage = `GA4 API invalid argument. This usually means: 1) Property ID is incorrect, 2) Date range is invalid, or 3) Metric/dimension combination is not allowed. Property: ${propertyId}, Date range: ${startDateStr} to ${endDateStr}`;
    } else if (apiError.code === 403 || apiError.statusCode === 403) {
      errorMessage = 'GA4 API access denied. Please check that the property ID is correct and the account has access.';
    } else if (apiError.code === 404 || apiError.statusCode === 404) {
      errorMessage = `GA4 property not found: ${propertyId}. Please verify the property ID is correct.`;
    }
    
    throw new Error(errorMessage);
  }

  // Log response summary for debugging
  const sessionsRows = sessionsResponse?.rows?.length || 0;
  const usersRows = usersResponse?.rows?.length || 0;
  const engagementRows = engagementResponse?.rows?.length || 0;
  const conversionsRows = conversionsResponse?.rows?.length || 0;
  const trendRows = trendResponse?.rows?.length || 0;

  console.log('[GA4] API responses received:', {
    propertyId,
    dateRange: { start: startDateStr, end: endDateStr },
    sessionsRows,
    usersRows,
    engagementRows,
    conversionsRows,
    trendRows,
  });

  // Log raw response data for debugging
  if (usersResponse?.rows?.[0]) {
    console.log('[GA4] Users response sample:', {
      rowCount: usersResponse.rows.length,
      metricValues: usersResponse.rows[0].metricValues?.map((mv: any, idx: number) => ({
        index: idx,
        value: mv.value,
        valueType: mv.valueType,
      })),
      note: 'Index 0: activeUsers, Index 1: totalUsers, Index 2: newUsers, Index 3: eventCount',
    });
  }

  // Log key events response for debugging
  if (keyEventsResponse?.rows && keyEventsResponse.rows.length > 0) {
    const keyEventsWithConversions = keyEventsResponse.rows
      .filter((row: any) => parseInt(row.metricValues?.[0]?.value || '0', 10) > 0)
      .map((row: any) => ({
        eventName: row.dimensionValues?.[0]?.value,
        conversions: row.metricValues?.[0]?.value,
      }));
    console.log('[GA4] Key Events response:', {
      totalEvents: keyEventsResponse.rows.length,
      keyEventsWithConversions: keyEventsWithConversions.length,
      sampleKeyEvents: keyEventsWithConversions.slice(0, 10),
    });
  }

  // Log conversions response for debugging
  if (conversionsResponse?.rows?.[0]) {
    console.log('[GA4] Conversions response:', {
      conversions: conversionsResponse.rows[0].metricValues?.[0]?.value,
      conversionRate: conversionsResponse.rows[0].metricValues?.[1]?.value,
    });
  }

  // Helpful debug when GA4 returns no rows at all
  if (!sessionsRows && !usersRows && !engagementRows && !conversionsRows && !trendRows) {
    console.warn(
      '[GA4] ⚠️ No data returned from GA4 API. Possible reasons:',
      {
        propertyId,
        startDate: startDateStr,
        endDate: endDateStr,
        possibleCauses: [
          'No data exists for this date range in GA4',
          'Property ID is incorrect',
          'Account does not have access to this property',
          'Date range is too recent (GA4 data can take 24-48 hours to appear)',
        ],
      }
    );
  }

  // Parse sessions by channel
  let totalSessions = 0;
  let organicSessions = 0;
  let directSessions = 0;
  let referralSessions = 0;
  let paidSessions = 0;

  if (sessionsResponse?.rows) {
    for (const row of sessionsResponse.rows) {
      const channel = row.dimensionValues?.[0]?.value || '';
      const sessions = parseInt(row.metricValues?.[0]?.value || '0', 10);
      totalSessions += sessions;

      const channelLower = channel.toLowerCase().trim();
      // Be strict to avoid counting "Paid Search" as organic.
      if (channelLower.includes("paid")) {
        paidSessions += sessions;
      } else if (channelLower === "organic search" || channelLower.includes("organic search")) {
        organicSessions += sessions;
      } else if (channelLower.includes('direct')) {
        directSessions += sessions;
      } else if (channelLower.includes('referral') || channelLower.includes('social')) {
        referralSessions += sessions;
      }
    }
  }

  // Parse engaged sessions by channel to get Organic Search engaged sessions
  let organicSearchEngagedSessions = 0;
  if (engagedSessionsByChannelResponse?.rows) {
    for (const row of engagedSessionsByChannelResponse.rows) {
      const channel = row.dimensionValues?.[0]?.value || "";
      const engaged = parseInt(row.metricValues?.[0]?.value || "0", 10);
      const channelLower = channel.toLowerCase().trim();
      if (channelLower.includes("paid")) continue;
      if (channelLower === "organic search" || channelLower.includes("organic search")) {
        organicSearchEngagedSessions += engaged;
      }
    }
  }

  // Parse users + events metrics: Active Users, Total Users, New Users, Event Count
  const activeUsers = parseInt(
    usersResponse?.rows?.[0]?.metricValues?.[0]?.value || '0',
    10
  );
  const totalUsers = parseInt(
    usersResponse?.rows?.[0]?.metricValues?.[1]?.value || '0',
    10
  );
  const newUsers = parseInt(
    usersResponse?.rows?.[0]?.metricValues?.[2]?.value || '0',
    10
  );
  const eventCount = parseInt(
    usersResponse?.rows?.[0]?.metricValues?.[3]?.value || '0',
    10
  );
  
  // Key Events - try multiple approaches to get accurate count
  let keyEvents = 0;
  
  // First, try to get from keyEventsResponse (sum of conversions metric for all events)
  if (keyEventsResponse?.rows && keyEventsResponse.rows.length > 0) {
    // Sum up the conversions metric from all events (only key events will have conversions > 0)
    // The conversions metric is at index 0 since we only requested that one metric
    keyEvents = keyEventsResponse.rows.reduce((sum: number, row: any) => {
      const conversions = parseInt(row.metricValues?.[0]?.value || '0', 10);
      return sum + conversions;
    }, 0);
    console.log('[GA4] Key events calculated from eventName query:', keyEvents, `(from ${keyEventsResponse.rows.length} events)`);
  }
  
  // Fallback to conversions metric if keyEventsResponse didn't work or returned 0
  if (keyEvents === 0 && conversionsResponse?.rows?.[0]) {
    const conversionsValue = parseInt(
      conversionsResponse.rows[0].metricValues?.[0]?.value || '0',
      10
    );
    if (conversionsValue > 0) {
      keyEvents = conversionsValue;
      console.log('[GA4] Key events from conversions metric:', keyEvents);
    }
  }
  
  // If still 0, log a warning
  if (keyEvents === 0) {
    console.warn('[GA4] ⚠️ Key events count is 0. This might indicate:', {
      hasKeyEventsResponse: !!keyEventsResponse,
      keyEventsResponseRows: keyEventsResponse?.rows?.length || 0,
      hasConversionsResponse: !!conversionsResponse,
      conversionsValue: conversionsResponse?.rows?.[0]?.metricValues?.[0]?.value || 'N/A',
      note: 'Make sure key events are configured in GA4 and marked as conversion events',
    });
  }

  // Log parsed values for debugging
  console.log('[GA4] Parsed metrics:', {
    activeUsers,
    totalUsers,
    newUsers,
    eventCount,
    keyEvents,
    totalSessions,
    organicSessions,
    note: 'totalUsers comes from usersResponse metricValues[1], newUsers from metricValues[2]',
  });
  
  // Additional validation logging for newUsers
  if (usersResponse?.rows?.[0]) {
    const rawNewUsers = usersResponse.rows[0].metricValues?.[2]?.value;
    console.log('[GA4] New Users validation:', {
      rawValue: rawNewUsers,
      parsedValue: newUsers,
      metricIndex: 2,
      allMetrics: usersResponse.rows[0].metricValues?.map((mv: any, idx: number) => ({
        index: idx,
        name:
          idx === 0
            ? 'activeUsers'
            : idx === 1
              ? 'totalUsers'
              : idx === 2
                ? 'newUsers'
                : idx === 3
                  ? 'eventCount'
                  : 'unknown',
        value: mv.value,
      })),
    });
  }

  // Parse engagement metrics
  const bounceRate = parseFloat(
    engagementResponse?.rows?.[0]?.metricValues?.[0]?.value || '0'
  );
  const avgSessionDuration = parseFloat(
    engagementResponse?.rows?.[0]?.metricValues?.[1]?.value || '0'
  );
  const pagesPerSession = parseFloat(
    engagementResponse?.rows?.[0]?.metricValues?.[2]?.value || '0'
  );
  // Engaged Sessions from GA4 engagedSessions metric
  const engagedSessions = parseInt(
    engagementResponse?.rows?.[0]?.metricValues?.[3]?.value || '0',
    10
  );
  // Engagement rate as decimal (e.g., 0.63 for 63%)
  const engagementRate = parseFloat(
    engagementResponse?.rows?.[0]?.metricValues?.[4]?.value || '0'
  );

  // Parse conversions
  const conversions = parseInt(
    conversionsResponse?.rows?.[0]?.metricValues?.[0]?.value || '0',
    10
  );
  const conversionRate = parseFloat(
    conversionsResponse?.rows?.[0]?.metricValues?.[1]?.value || '0'
  );

  const newUsersTrend: TrendPoint[] = [];
  const activeUsersTrend: TrendPoint[] = [];

  if (trendResponse?.rows) {
    for (const row of trendResponse.rows) {
      const dateValue = row.dimensionValues?.[0]?.value || '';
      const formattedDate =
        dateValue && dateValue.length === 8
          ? `${dateValue.substring(0, 4)}-${dateValue.substring(4, 6)}-${dateValue.substring(6, 8)}`
          : dateValue;
      const newUsersPoint = parseInt(row.metricValues?.[0]?.value || '0', 10);
      const activeUsersPoint = parseInt(row.metricValues?.[1]?.value || '0', 10);

      newUsersTrend.push({
        date: formattedDate,
        value: newUsersPoint,
      });

      activeUsersTrend.push({
        date: formattedDate,
        value: activeUsersPoint,
      });
    }
  }

  return {
    totalSessions,
    organicSessions,
    directSessions,
    referralSessions,
    paidSessions,
    organicSearchEngagedSessions,
    bounceRate,
    avgSessionDuration,
    pagesPerSession,
    conversions,
    conversionRate,
    activeUsers,
    totalUsers,
    eventCount,
    newUsers,
    keyEvents,
    engagedSessions, // Engaged Sessions from GA4
    engagementRate, // Engagement rate as decimal
    newUsersTrend,
    activeUsersTrend, // Replaces totalUsersTrend
  };
}

/**
 * Fetch Organic Search engaged sessions (GA4) for a given period.
 * Used by the dashboard when serving cached GA4 metrics from DB.
 */
export async function fetchGA4OrganicSearchEngagedSessions(
  clientId: string,
  startDate: Date,
  endDate: Date
): Promise<number | null> {
  const client = await prisma.client.findUnique({
    where: { id: clientId },
    select: { ga4PropertyId: true },
  });

  if (!client?.ga4PropertyId) return null;

  const analytics = await getAnalyticsClient(clientId);
  const propertyId = client.ga4PropertyId.startsWith("properties/")
    ? client.ga4PropertyId
    : `properties/${client.ga4PropertyId}`;

  const startDateStr = startDate.toISOString().split("T")[0];
  const endDateStr = endDate.toISOString().split("T")[0];

  try {
    const [response] = await analytics.runReport({
      property: propertyId,
      dateRanges: [{ startDate: startDateStr, endDate: endDateStr }],
      dimensions: [{ name: "sessionDefaultChannelGroup" }],
      metrics: [{ name: "engagedSessions" }],
    });

    let organic = 0;
    for (const row of response?.rows || []) {
      const channel = row.dimensionValues?.[0]?.value || "";
      const engaged = parseInt(row.metricValues?.[0]?.value || "0", 10);
      const channelLower = channel.toLowerCase().trim();
      if (channelLower.includes("paid")) continue;
      if (channelLower === "organic search" || channelLower.includes("organic search")) {
        organic += engaged;
      }
    }
    return Number.isFinite(organic) ? organic : 0;
  } catch (error: any) {
    console.warn("[GA4] Organic Search engaged sessions request failed:", {
      error: error.message,
      code: error.code,
      propertyId,
    });
    return null;
  }
}

/**
 * Fetch GA4 events data (form submissions, video plays, downloads, etc.)
 */
export async function fetchGA4EventsData(
  clientId: string,
  startDate: Date,
  endDate: Date
): Promise<{
  events: Array<{
    name: string;
    count: number;
    change?: string; // Percentage change
  }>;
}> {
  const client = await prisma.client.findUnique({
    where: { id: clientId },
    select: { ga4PropertyId: true },
  });

  if (!client?.ga4PropertyId) {
    return { events: [] };
  }

  const analytics = await getAnalyticsClient(clientId);
  const propertyId = client.ga4PropertyId.startsWith('properties/') 
    ? client.ga4PropertyId 
    : `properties/${client.ga4PropertyId}`;

  const startDateStr = startDate.toISOString().split('T')[0];
  const endDateStr = endDate.toISOString().split('T')[0];

  // Calculate previous period for change calculation
  const daysDiff = Math.ceil((endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24));
  const previousStartDate = new Date(startDate);
  previousStartDate.setDate(previousStartDate.getDate() - daysDiff);
  const previousEndDate = new Date(startDate);
  const previousStartDateStr = previousStartDate.toISOString().split('T')[0];
  const previousEndDateStr = previousEndDate.toISOString().split('T')[0];

  try {
    // Fetch current period events
    const [currentEventsResponse] = await analytics.runReport({
      property: propertyId,
      dateRanges: [
        {
          startDate: startDateStr,
          endDate: endDateStr,
        },
      ],
      dimensions: [{ name: 'eventName' }],
      metrics: [
        { name: 'eventCount' },
      ],
      orderBys: [
        {
          metric: { metricName: 'eventCount' },
          desc: true,
        },
      ],
      limit: 100,
    });

    // Fetch previous period events for change calculation
    let previousEventsResponse;
    try {
      [previousEventsResponse] = await analytics.runReport({
        property: propertyId,
        dateRanges: [
          {
            startDate: previousStartDateStr,
            endDate: previousEndDateStr,
          },
        ],
        dimensions: [{ name: 'eventName' }],
        metrics: [
          { name: 'eventCount' },
        ],
        orderBys: [
          {
            metric: { metricName: 'eventCount' },
            desc: true,
          },
        ],
        limit: 100,
      });
    } catch (prevError) {
      console.warn('[GA4] Failed to fetch previous period events:', prevError);
      previousEventsResponse = null;
    }

    // Process current events
    const currentEventsMap = new Map<string, number>();
    if (currentEventsResponse?.rows) {
      currentEventsResponse.rows.forEach((row: any) => {
        const eventName = row.dimensionValues?.[0]?.value || '';
        const count = parseInt(row.metricValues?.[0]?.value || '0', 10);
        if (eventName && count > 0) {
          currentEventsMap.set(eventName, count);
        }
      });
    }

    // Process previous events
    const previousEventsMap = new Map<string, number>();
    if (previousEventsResponse?.rows) {
      previousEventsResponse.rows.forEach((row: any) => {
        const eventName = row.dimensionValues?.[0]?.value || '';
        const count = parseInt(row.metricValues?.[0]?.value || '0', 10);
        if (eventName && count > 0) {
          previousEventsMap.set(eventName, count);
        }
      });
    }

    // Map common event names to display names
    const eventNameMap: Record<string, string> = {
      'form_submit': 'Form Submissions',
      'form_submission': 'Form Submissions',
      'generate_lead': 'Form Submissions',
      'video_start': 'Video Plays',
      'video_progress': 'Video Plays',
      'video_complete': 'Video Plays',
      'file_download': 'Downloads',
      'download': 'Downloads',
      'page_view': 'Page Views',
    };

    // Aggregate events by display name
    const eventsMap = new Map<string, { count: number; previousCount: number }>();
    
    currentEventsMap.forEach((count, eventName) => {
      const displayName = eventNameMap[eventName.toLowerCase()] || eventName;
      const current = eventsMap.get(displayName) || { count: 0, previousCount: 0 };
      current.count += count;
      eventsMap.set(displayName, current);
    });

    previousEventsMap.forEach((count, eventName) => {
      const displayName = eventNameMap[eventName.toLowerCase()] || eventName;
      const current = eventsMap.get(displayName) || { count: 0, previousCount: 0 };
      current.previousCount += count;
      eventsMap.set(displayName, current);
    });

    // Convert to array and calculate changes
    const events = Array.from(eventsMap.entries())
      .map(([name, data]) => {
        let change: string | undefined;
        if (data.previousCount > 0) {
          const changePercent = ((data.count - data.previousCount) / data.previousCount) * 100;
          change = `${changePercent >= 0 ? '+' : ''}${changePercent.toFixed(0)}%`;
        } else if (data.count > 0) {
          change = '+100%';
        }

        return {
          name,
          count: data.count,
          change,
        };
      })
      .filter(event => event.count > 0)
      .sort((a, b) => b.count - a.count)
      .slice(0, 10); // Top 10 events

    return { events };
  } catch (error: any) {
    console.error('[GA4] Failed to fetch events data:', error);
    return { events: [] };
  }
}

/**
 * Fetch engagement-only metrics from GA4 (fast path)
 * Used to populate engagedSessions even when other metrics come from DB cache.
 */
export async function fetchGA4EngagementSummary(
  clientId: string,
  startDate: Date,
  endDate: Date
): Promise<{ engagedSessions: number; engagementRate: number | null } | null> {
  const client = await prisma.client.findUnique({
    where: { id: clientId },
    select: { ga4PropertyId: true },
  });

  if (!client?.ga4PropertyId) {
    return null;
  }

  const analytics = await getAnalyticsClient(clientId);
  const propertyId = client.ga4PropertyId.startsWith("properties/") ? client.ga4PropertyId : `properties/${client.ga4PropertyId}`;

  const startDateStr = startDate.toISOString().split("T")[0];
  const endDateStr = endDate.toISOString().split("T")[0];

  try {
    const [response] = await analytics.runReport({
      property: propertyId,
      dateRanges: [{ startDate: startDateStr, endDate: endDateStr }],
      metrics: [{ name: "engagedSessions" }, { name: "engagementRate" }],
    } as any);

    const row = response?.rows?.[0];
    const engagedSessions = parseInt(row?.metricValues?.[0]?.value || "0", 10);
    const engagementRateRaw = row?.metricValues?.[1]?.value;
    const engagementRate = engagementRateRaw !== undefined && engagementRateRaw !== null ? Number(engagementRateRaw) : null;

    return {
      engagedSessions: Number.isFinite(engagedSessions) ? engagedSessions : 0,
      engagementRate: engagementRate !== null && Number.isFinite(engagementRate) ? engagementRate : null,
    };
  } catch (error: any) {
    console.warn("[GA4] Engagement-only request failed:", {
      error: error.message,
      code: error.code,
      propertyId,
    });
    return null;
  }
}

/**
 * Save GA4 metrics to database
 */
export async function saveGA4MetricsToDB(
  clientId: string,
  startDate: Date,
  endDate: Date,
  trafficData: {
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
    activeUsers: number;
    totalUsers: number;
    eventCount: number;
    newUsers: number;
    keyEvents: number;
    engagedSessions: number;
    engagementRate: number;
    newUsersTrend: TrendPoint[];
    activeUsersTrend: TrendPoint[];
  },
  eventsData?: {
    events: Array<{
      name: string;
      count: number;
      change?: string;
    }>;
  },
  visitorSourcesData?: {
    sources: Array<{
      source: string;
      users: number;
    }>;
  }
): Promise<void> {
  try {
    // Upsert GA4 metrics (update if exists for client, otherwise create)
    // Note: Schema has clientId @unique, so only one record per client
    await prisma.ga4Metrics.upsert({
      where: {
        clientId: clientId,
      },
      update: {
        startDate,
        endDate,
        activeUsers: trafficData.activeUsers,
        eventCount: trafficData.eventCount,
        newUsers: trafficData.newUsers,
        keyEvents: trafficData.keyEvents,
        totalSessions: trafficData.totalSessions,
        organicSessions: trafficData.organicSessions,
        directSessions: trafficData.directSessions,
        referralSessions: trafficData.referralSessions,
        paidSessions: trafficData.paidSessions,
        bounceRate: trafficData.bounceRate,
        avgSessionDuration: trafficData.avgSessionDuration,
        pagesPerSession: trafficData.pagesPerSession,
        conversions: trafficData.conversions,
        conversionRate: trafficData.conversionRate,
        newUsersTrend: trafficData.newUsersTrend.length > 0 ? JSON.stringify(trafficData.newUsersTrend) : undefined,
        activeUsersTrend: trafficData.activeUsersTrend.length > 0 ? JSON.stringify(trafficData.activeUsersTrend) : undefined,
        events: eventsData?.events && eventsData.events.length > 0 ? JSON.stringify(eventsData.events) : undefined,
        // engagementRate: trafficData.engagementRate ?? undefined,
      },
      create: {
        clientId,
        startDate,
        endDate,
        activeUsers: trafficData.activeUsers,
        eventCount: trafficData.eventCount,
        newUsers: trafficData.newUsers,
        keyEvents: trafficData.keyEvents,
        totalSessions: trafficData.totalSessions,
        organicSessions: trafficData.organicSessions,
        directSessions: trafficData.directSessions,
        referralSessions: trafficData.referralSessions,
        paidSessions: trafficData.paidSessions,
        bounceRate: trafficData.bounceRate,
        avgSessionDuration: trafficData.avgSessionDuration,
        pagesPerSession: trafficData.pagesPerSession,
        conversions: trafficData.conversions,
        conversionRate: trafficData.conversionRate,
        newUsersTrend: trafficData.newUsersTrend.length > 0 ? JSON.stringify(trafficData.newUsersTrend) : undefined,
        activeUsersTrend: trafficData.activeUsersTrend.length > 0 ? JSON.stringify(trafficData.activeUsersTrend) : undefined,
        // totalUsersTrend: trafficData.totalUsersTrend?.length > 0 ? trafficData.totalUsersTrend : undefined,
        events: eventsData?.events && eventsData.events.length > 0 ? JSON.stringify(eventsData.events) : undefined,
        // engagementRate: trafficData.engagementRate ?? undefined,
      },
    });

    // Some environments have newer GA4 columns (added via migrations) that are not represented in Prisma schema.
    // Write them via raw SQL when present so "Web Visitors" can use GA4 totalUsers.
    try {
      const cols = await prisma.$queryRaw<Array<{ column_name: string }>>`
        SELECT column_name
        FROM information_schema.columns
        WHERE table_schema = DATABASE()
          AND table_name = 'ga4_metrics'
          AND column_name IN ('totalUsers', 'engagedSessions')
      `;
      const hasTotalUsers = cols.some((c) => c.column_name === "totalUsers");
      const hasEngagedSessions = cols.some((c) => c.column_name === "engagedSessions");

      if (hasTotalUsers) {
        await prisma.$executeRaw`
          UPDATE ga4_metrics
          SET totalUsers = ${trafficData.totalUsers}
          WHERE clientId = ${clientId}
        `;
      }

      if (hasEngagedSessions) {
        await prisma.$executeRaw`
          UPDATE ga4_metrics
          SET engagedSessions = ${trafficData.engagedSessions}
          WHERE clientId = ${clientId}
        `;
      }
    } catch (writeExtraError) {
      console.warn("[GA4] Failed to write extra GA4 columns (non-fatal):", writeExtraError);
    }

    console.log(`[GA4] Saved metrics to database for client ${clientId} (${startDate.toISOString().split('T')[0]} to ${endDate.toISOString().split('T')[0]})`);
  } catch (error: any) {
    console.error('[GA4] Failed to save metrics to database:', error);
    throw error;
  }
}

/**
 * Get GA4 metrics from database
 * Returns the most recent metrics snapshot that matches the date range
 */
export async function getGA4MetricsFromDB(
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
  activeUsers: number;
  eventCount: number;
  newUsers: number;
  keyEvents: number;
  newUsersTrend: TrendPoint[];
  activeUsersTrend: TrendPoint[];
  totalUsers: number;
  engagedSessions: number;
  engagementRate: number | null;
  events: Array<{
    name: string;
    count: number;
    change?: string;
  }> | null;
  visitorSources: Array<{
    source: string;
    users: number;
  }> | null;
} | null> {
  try {
    const dateKey = (d: unknown) => {
      try {
        return new Date(d as any).toISOString().slice(0, 10);
      } catch {
        return "";
      }
    };

    const requestedStartKey = dateKey(startDate);
    const requestedEndKey = dateKey(endDate);

    // Find the most recent metrics snapshot that overlaps with the requested date range
    // IMPORTANT: Some DBs may not have newer GA4 columns yet (totalUsers, engagedSessions, engagementRate, visitorSources).
    // To avoid "Unknown column" crashes, only select the stable base columns and compute fallbacks in JS.
    const metrics = await prisma.$queryRaw<any[]>`
      SELECT
        startDate, endDate,
        totalSessions, organicSessions, directSessions, referralSessions, paidSessions,
        bounceRate, avgSessionDuration, pagesPerSession,
        conversions, conversionRate,
        activeUsers, eventCount, newUsers, keyEvents,
        newUsersTrend, activeUsersTrend, events
      FROM ga4_metrics
      WHERE clientId = ${clientId}
        AND startDate <= ${endDate}
        AND endDate >= ${startDate}
      ORDER BY endDate DESC
      LIMIT 1
    `;

    if (!metrics || metrics.length === 0) {
      return null;
    }

    const metric = metrics[0];

    // IMPORTANT:
    // We store only a single GA4 snapshot per client. If the saved snapshot does NOT match the
    // requested date range, using it would show wrong totals/trends (e.g., 30-day data for a 7-day view).
    // So only use cached data when the day-level start/end match exactly.
    const storedStartKey = dateKey(metric.startDate);
    const storedEndKey = dateKey(metric.endDate);
    if (
      !requestedStartKey ||
      !requestedEndKey ||
      !storedStartKey ||
      !storedEndKey ||
      storedStartKey !== requestedStartKey ||
      storedEndKey !== requestedEndKey
    ) {
      return null;
    }

    // If the DB has newer columns, read them from the same selected row.
    // We keep this separate so environments without these columns don't crash.
    let totalUsersFromDb: number | null = null;
    let engagedSessionsFromDb: number | null = null;
    try {
      const cols = await prisma.$queryRaw<Array<{ column_name: string }>>`
        SELECT column_name
        FROM information_schema.columns
        WHERE table_schema = DATABASE()
          AND table_name = 'ga4_metrics'
          AND column_name IN ('totalUsers', 'engagedSessions')
      `;
      const hasTotalUsers = cols.some((c) => c.column_name === "totalUsers");
      const hasEngagedSessions = cols.some((c) => c.column_name === "engagedSessions");

      if (hasTotalUsers) {
        const rows = await prisma.$queryRaw<any[]>`
          SELECT totalUsers
          FROM ga4_metrics
          WHERE clientId = ${clientId}
            AND startDate <= ${endDate}
            AND endDate >= ${startDate}
          ORDER BY endDate DESC
          LIMIT 1
        `;
        totalUsersFromDb = rows?.[0]?.totalUsers !== undefined ? Number(rows[0].totalUsers) : null;
      }

      if (hasEngagedSessions) {
        const rows = await prisma.$queryRaw<any[]>`
          SELECT engagedSessions
          FROM ga4_metrics
          WHERE clientId = ${clientId}
            AND startDate <= ${endDate}
            AND endDate >= ${startDate}
          ORDER BY endDate DESC
          LIMIT 1
        `;
        engagedSessionsFromDb = rows?.[0]?.engagedSessions !== undefined ? Number(rows[0].engagedSessions) : null;
      }
    } catch (readExtraError) {
      // Non-fatal; we'll fall back to the legacy values.
      console.warn("[GA4] Failed to read extra GA4 columns (non-fatal):", readExtraError);
    }

    // Convert JSON fields back to arrays (MySQL returns JSON as objects, not strings)
    const newUsersTrend: TrendPoint[] = metric.newUsersTrend
      ? (Array.isArray(metric.newUsersTrend) ? metric.newUsersTrend : JSON.parse(String(metric.newUsersTrend))) as TrendPoint[]
      : [];
    const activeUsersTrend: TrendPoint[] = metric.activeUsersTrend
      ? (Array.isArray(metric.activeUsersTrend) ? metric.activeUsersTrend : JSON.parse(String(metric.activeUsersTrend))) as TrendPoint[]
      : [];
    const events = metric.events
      ? (Array.isArray(metric.events) ? metric.events : (typeof metric.events === 'string' ? JSON.parse(metric.events) : metric.events)) as Array<{ name: string; count: number; change?: string }>
      : null;
    return {
      totalSessions: Number(metric.totalSessions),
      organicSessions: Number(metric.organicSessions),
      directSessions: Number(metric.directSessions),
      referralSessions: Number(metric.referralSessions),
      paidSessions: Number(metric.paidSessions),
      bounceRate: Number(metric.bounceRate),
      avgSessionDuration: Number(metric.avgSessionDuration),
      pagesPerSession: Number(metric.pagesPerSession),
      conversions: Number(metric.conversions),
      conversionRate: Number(metric.conversionRate),
      activeUsers: Number(metric.activeUsers),
      eventCount: Number(metric.eventCount),
      newUsers: Number(metric.newUsers),
      keyEvents: Number(metric.keyEvents),
      newUsersTrend,
      activeUsersTrend,
      events,
      visitorSources: null,
      // Fallbacks (DB may not have these columns yet)
      totalUsers: totalUsersFromDb !== null ? totalUsersFromDb : Number(metric.activeUsers),
      engagedSessions: engagedSessionsFromDb !== null ? engagedSessionsFromDb : Number(metric.keyEvents),
      engagementRate: null,
    };
  } catch (error: any) {
    console.error('[GA4] Failed to get metrics from database:', error);
    return null;
  }
}

/**
 * Get analytics admin client with valid access token
 */
async function getAnalyticsAdminClient(clientId: string) {
  const client = await prisma.client.findUnique({
    where: { id: clientId },
    select: {
      ga4AccessToken: true,
      ga4RefreshToken: true,
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
    } catch (error: any) {
      const invalidGrant = isGa4InvalidGrant(error);
      const errMsg = String(error?.message || "unknown_error");
      const respErr = String(error?.response?.data?.error || "");
      const respDesc = String(error?.response?.data?.error_description || "");

      if (invalidGrant) {
        ga4RevokedClientCache.set(clientId, Date.now());
        console.warn(
          `[GA4] Admin refresh token invalid_grant for clientId=${clientId}. Marking GA4 disconnected. (${respErr || errMsg}${respDesc ? `: ${respDesc}` : ""})`
        );
        try {
          await prisma.client.update({
            where: { id: clientId },
            data: {
              ga4AccessToken: null,
              ga4RefreshToken: null,
              ga4ConnectedAt: null,
            },
          });
        } catch (disconnectErr: any) {
          console.warn(
            `[GA4] Failed to mark clientId=${clientId} disconnected (admin path):`,
            disconnectErr?.message || disconnectErr
          );
        }
        throw new Error('GA4 token expired or revoked. Please reconnect GA4.');
      }

      console.warn(
        `[GA4] Admin token refresh failed for clientId=${clientId}: ${respErr || errMsg}${respDesc ? `: ${respDesc}` : ""}`
      );
      throw new Error('GA4 token refresh failed. Please reconnect GA4.');
    }
  }

  const oauth2Client = getOAuth2Client();
  oauth2Client.setCredentials({
    access_token: accessToken,
    refresh_token: client.ga4RefreshToken,
  });

  return google.analyticsadmin({ version: 'v1alpha', auth: oauth2Client });
}

/**
 * List all GA4 accounts and properties accessible by the authenticated user
 */
export type GA4Property = {
  propertyId: string;
  propertyName: string;
  accountId: string;
  accountName: string;
  displayName: string;
};

export async function listGA4Properties(clientId: string): Promise<GA4Property[]> {
  try {
    const admin = await getAnalyticsAdminClient(clientId);
    
    // List all accounts first to get account names
    const accountsResponse = await admin.accounts.list();
    const accounts = accountsResponse.data.accounts || [];
    
    if (accounts.length === 0) {
      return [];
    }
    
    // Create a map of account ID to account name
    const accountMap = new Map<string, string>();
    accounts.forEach((account) => {
      const accountId = account.name?.split('/')[1] || '';
      if (accountId) {
        accountMap.set(accountId, account.displayName || accountId);
      }
    });
    
    // For each account, list its properties
    const propertyPromises = accounts.map(async (account) => {
      try {
        const accountId = account.name?.split('/')[1] || '';
        if (!accountId) return [];
        
        // List properties for this account
        const propertiesResponse = await admin.properties.list({
          filter: `parent:accounts/${accountId}`,
        });
        
        const properties = propertiesResponse.data.properties || [];
        
        return properties.map((property) => {
          // Property name format: "properties/123456789"
          const propertyId = property.name?.split('/')[1] || '';
          const accountName = accountMap.get(accountId) || accountId;
          
          return {
            propertyId,
            propertyName: property.displayName || propertyId,
            accountId,
            accountName,
            displayName: `${accountName} - ${property.displayName || propertyId}`,
          };
        });
      } catch (error) {
        console.warn(`Failed to list properties for account ${account.name}:`, error);
        return [];
      }
    });

    const propertyArrays = await Promise.all(propertyPromises);
    return propertyArrays.flat();
  } catch (error: any) {
    console.error('Failed to list GA4 properties:', error);
    throw new Error(`Failed to list GA4 properties: ${error.message || 'Unknown error'}`);
  }
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

