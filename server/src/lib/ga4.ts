import { google } from 'googleapis';
import { BetaAnalyticsDataClient } from '@google-analytics/data';
import { GoogleAuth } from 'google-auth-library';
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

  const oauth2Client = getOAuth2Client();
  oauth2Client.setCredentials({
    access_token: accessToken,
    refresh_token: client.ga4RefreshToken,
  });

  // Always try to refresh token to ensure it's valid
  try {
    // Get a fresh access token (this will refresh if expired)
    const tokenResponse = await oauth2Client.getAccessToken();
    const freshToken = tokenResponse?.token;
    
    if (freshToken && freshToken !== accessToken) {
      // Update stored access token if it changed
      await prisma.client.update({
        where: { id: clientId },
        data: { ga4AccessToken: freshToken },
      });
      accessToken = freshToken;
    }
  } catch (error) {
    console.error('Failed to refresh GA4 token:', error);
    throw new Error('GA4 token expired. Please reconnect GA4.');
  }

  // Set credentials on OAuth2Client (already done above, but ensure it's set)
  oauth2Client.setCredentials({
    access_token: accessToken,
    refresh_token: client.ga4RefreshToken,
  });

  // BetaAnalyticsDataClient uses gRPC and needs OAuth tokens passed correctly
  // The issue: gRPC clients need the token in metadata format
  // We'll create a custom auth adapter that works with gRPC
  
  // Ensure OAuth2Client has the latest token
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

  // CRITICAL: For gRPC, we must ensure the auth can provide tokens
  // Test authentication before creating the client
  try {
    // Get a fresh token (this will refresh if needed)
    const tokenInfo = await auth.getAccessToken();
    if (!tokenInfo) {
      throw new Error('Failed to get access token from GoogleAuth');
    }
    
    // Update stored token if it changed
    if (tokenInfo !== accessToken) {
      await prisma.client.update({
        where: { id: clientId },
        data: { ga4AccessToken: tokenInfo },
      });
      accessToken = tokenInfo;
      console.log(`[GA4] Token refreshed and updated in database`);
    }
    
    console.log(`[GA4] Verified access token (length: ${tokenInfo.length})`);
    
    // Verify we can get request metadata (required for gRPC)
    // Note: getRequestMetadata might not exist on GoogleAuth, so we'll use getAccessToken directly
    const requestMetadata = await (auth as any).getRequestMetadata?.() || { headers: {} };
    const authHeader = requestMetadata?.headers?.Authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      console.error('[GA4] Invalid auth header:', { 
        hasMetadata: !!requestMetadata, 
        headers: requestMetadata?.headers,
        authHeader: authHeader ? authHeader.substring(0, 20) : 'missing'
      });
      throw new Error('Failed to get valid authorization header for gRPC');
    }
    console.log(`[GA4] Verified authorization metadata for gRPC: ${authHeader.substring(0, 25)}...`);
  } catch (tokenError: any) {
    console.error('[GA4] Authentication verification failed:', {
      error: tokenError.message,
      stack: tokenError.stack?.substring(0, 300),
      hasAccessToken: !!accessToken,
      hasRefreshToken: !!client.ga4RefreshToken,
      clientId: process.env.GA4_CLIENT_ID ? 'set' : 'missing',
      clientSecret: process.env.GA4_CLIENT_SECRET ? 'set' : 'missing',
    });
    throw new Error(`GA4 authentication failed: ${tokenError.message}. Please reconnect your GA4 account.`);
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
  bounceRate: number;
  avgSessionDuration: number;
  pagesPerSession: number;
  conversions: number;
  conversionRate: number;
  activeUsers: number; // Replaces totalUsers/Website Visitors
  eventCount: number; // Replaces organicSessions/Organic Traffic
  newUsers: number; // Replaces firstTimeVisitors/First Time Visitors
  keyEvents: number; // Replaces engagedVisitors/Engaged Visitors (conversions)
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

  // Run multiple requests in parallel for better performance
  let sessionsResponse, usersResponse, engagementResponse, conversionsResponse, trendResponse;
  
  try {
    const responses = await Promise.all([
      // Sessions by channel
      analytics.runReport({
        property: propertyId,
        dateRanges: [
          {
            startDate: startDateStr,
            endDate: endDateStr,
          },
        ],
        dimensions: [{ name: 'sessionDefaultChannelGroup' }],
        metrics: [{ name: 'sessions' }],
      }),
    // Active Users, New Users, Event Count, and Key Events (conversions)
    analytics.runReport({
      property: propertyId,
      dateRanges: [
        {
          startDate: startDateStr,
          endDate: endDateStr,
        },
      ],
      metrics: [
        { name: 'activeUsers' }, // Active Users
        { name: 'newUsers' }, // New Users
        { name: 'eventCount' }, // Event Count
        { name: 'conversions' }, // Key Events (conversions)
      ],
    }),
    // Engagement metrics
    analytics.runReport({
      property: propertyId,
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
    }),
    // Conversions
    analytics.runReport({
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
    }),
    // Trend data (daily new users + active users)
    analytics.runReport({
      property: propertyId,
      dateRanges: [
        {
          startDate: startDateStr,
          endDate: endDateStr,
        },
      ],
      dimensions: [{ name: 'date' }],
      metrics: [
        { name: 'newUsers' },
        { name: 'activeUsers' }, // Changed from totalUsers to activeUsers
      ],
      orderBys: [
        {
          dimension: { dimensionName: 'date' },
        },
      ],
    }),
    ]);

    // Extract the response data from each promise result
    // runReport returns [response, request, metadata] - we need the first element
    sessionsResponse = responses[0][0];
    usersResponse = responses[1][0];
    engagementResponse = responses[2][0];
    conversionsResponse = responses[3][0];
    trendResponse = responses[4][0];
  } catch (apiError: any) {
    console.error('[GA4] API call failed:', {
      error: apiError.message,
      code: apiError.code,
      status: apiError.status || apiError.statusCode,
      statusText: apiError.statusText,
      propertyId,
      stack: apiError.stack,
    });
    
    // More detailed error message
    let errorMessage = `Failed to fetch GA4 data: ${apiError.message || 'Unknown error'}`;
    if (apiError.code === 403 || apiError.statusCode === 403) {
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

  console.log('GA4 API responses:', {
    propertyId,
    dateRange: { start: startDateStr, end: endDateStr },
    sessionsRows,
    usersRows,
    engagementRows,
    conversionsRows,
    trendRows,
  });

  // Helpful debug when GA4 returns no rows at all
  if (!sessionsRows && !usersRows && !engagementRows && !conversionsRows && !trendRows) {
    console.warn(
      'GA4 returned no rows for this request. Possible reasons: no data for date range, wrong property, or filters.',
      { propertyId, startDate: startDateStr, endDate: endDateStr }
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

  // Parse new metrics: Active Users, New Users, Event Count, Key Events
  const activeUsers = parseInt(
    usersResponse?.rows?.[0]?.metricValues?.[0]?.value || '0',
    10
  );
  const newUsers = parseInt(
    usersResponse?.rows?.[0]?.metricValues?.[1]?.value || '0',
    10
  );
  const eventCount = parseInt(
    usersResponse?.rows?.[0]?.metricValues?.[2]?.value || '0',
    10
  );
  const keyEvents = parseInt(
    usersResponse?.rows?.[0]?.metricValues?.[3]?.value || '0',
    10
  );

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
  const engagedVisitors = parseInt(
    engagementResponse?.rows?.[0]?.metricValues?.[3]?.value || '0',
    10
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
    bounceRate,
    avgSessionDuration,
    pagesPerSession,
    conversions,
    conversionRate,
    activeUsers, // Replaces totalUsers
    eventCount, // Replaces organicSessions for display
    newUsers, // Replaces firstTimeVisitors
    keyEvents, // Replaces engagedVisitors (conversions)
    newUsersTrend,
    activeUsersTrend, // Replaces totalUsersTrend
  };
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

