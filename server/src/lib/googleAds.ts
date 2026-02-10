import { google } from 'googleapis';
import { prisma } from './prisma.js';

const GOOGLE_ADS_REVOKED_TOKEN_TTL_MS = 10 * 60 * 1000; // 10 minutes
const googleAdsRevokedClientCache = new Map<string, number>();

function isGoogleAdsInvalidGrant(error: any): boolean {
  const msg = String(error?.message || "");
  const respErr = String(error?.response?.data?.error || "");
  const respDesc = String(error?.response?.data?.error_description || "");
  return (
    msg.includes("invalid_grant") ||
    respErr === "invalid_grant" ||
    msg.includes("unauthorized_client") ||
    respErr === "unauthorized_client" ||
    respDesc.toLowerCase().includes("expired") ||
    respDesc.toLowerCase().includes("revoked")
  );
}

function isGoogleAdsRevokedCached(clientId: string): boolean {
  const ts = googleAdsRevokedClientCache.get(clientId);
  if (!ts) return false;
  if (Date.now() - ts > GOOGLE_ADS_REVOKED_TOKEN_TTL_MS) {
    googleAdsRevokedClientCache.delete(clientId);
    return false;
  }
  return true;
}

const GOOGLE_ADS_CALLBACK_PATH = '/api/clients/google-ads/callback';

/** Single source of redirect URI so auth URL and token exchange always match (required for refresh_token). */
function getGoogleAdsRedirectUri(): string {
  return (
    process.env.GOOGLE_ADS_REDIRECT_URI ||
    `${process.env.BACKEND_URL || 'http://localhost:5000'}${GOOGLE_ADS_CALLBACK_PATH}`
  );
}

/**
 * Google Ads API requires a developer token for all data endpoints (searchStream, customer details, etc.).
 * Returns the token or throws a clear error if not set.
 */
function getGoogleAdsDeveloperToken(): string {
  const token = process.env.GOOGLE_ADS_DEVELOPER_TOKEN?.trim();
  if (!token) {
    throw new Error(
      'Google Ads API requires a developer token. Set GOOGLE_ADS_DEVELOPER_TOKEN in server/.env. ' +
      'Get it from your Google Ads account: Tools & Settings → Setup → API Center.'
    );
  }
  return token;
}

/**
 * Get OAuth2 client for Google Ads (uses same redirect_uri as auth URL for valid token exchange)
 */
function getOAuth2Client() {
  const clientId = process.env.GOOGLE_ADS_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_ADS_CLIENT_SECRET;
  const redirectUri = getGoogleAdsRedirectUri();

  if (!clientId || !clientSecret) {
    const errorMsg = 'Google Ads credentials not configured. Please set GOOGLE_ADS_CLIENT_ID and GOOGLE_ADS_CLIENT_SECRET environment variables in server/.env file.\n\n' +
      'Required variables:\n' +
      '  GOOGLE_ADS_CLIENT_ID=your_client_id.apps.googleusercontent.com\n' +
      '  GOOGLE_ADS_CLIENT_SECRET=your_client_secret\n' +
      `  GOOGLE_ADS_REDIRECT_URI=${process.env.BACKEND_URL || 'http://localhost:5000'}/api/clients/google-ads/callback\n\n` +
      'See Google Ads API documentation for setup instructions.';
    throw new Error(errorMsg);
  }

  return new google.auth.OAuth2(clientId, clientSecret, redirectUri);
}

/**
 * Get Google Ads authorization URL for OAuth flow.
 * @param clientId - Client ID to store tokens for
 * @param options.popup - If true, state includes "popup" so callback sends postMessage + closes instead of redirecting
 */
export function getGoogleAdsAuthUrl(clientId: string, options?: { popup?: boolean }): string {
  const oauth2Client = getOAuth2Client();
  const scopes = [
    'https://www.googleapis.com/auth/adwords', // Google Ads API scope
    'https://www.googleapis.com/auth/userinfo.email', // Required to get user email
  ];
  const state = options?.popup ? `${clientId}|popup` : clientId;

  return oauth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: scopes,
    prompt: 'consent', // Force consent to get refresh token
    state,
    redirect_uri: getGoogleAdsRedirectUri(),
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
  const redirectUri = getGoogleAdsRedirectUri();

  let tokens;
  try {
    const tokenResponse = await oauth2Client.getToken({ code, redirect_uri: redirectUri });
    tokens = tokenResponse.tokens;

    if (!tokens.access_token || !tokens.refresh_token) {
      throw new Error('Failed to get access and refresh tokens from Google');
    }
  } catch (error: any) {
    console.error('[Google Ads] Token exchange failed:', {
      error: error.message,
      code: error.code,
      redirectUri,
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
 * Get authenticated OAuth2 client for Google Ads API
 */
export async function getGoogleAdsClient(clientId: string) {
  if (isGoogleAdsRevokedCached(clientId)) {
    throw new Error('Google Ads token expired or revoked. Please reconnect Google Ads.');
  }

  const client = await prisma.client.findUnique({
    where: { id: clientId },
    select: {
      googleAdsAccessToken: true,
      googleAdsRefreshToken: true,
      googleAdsCustomerId: true,
    },
  });

  if (!client?.googleAdsRefreshToken) {
    throw new Error('Google Ads is not connected for this client');
  }

  let accessToken = client.googleAdsAccessToken;

  // Refresh token if needed
  try {
    accessToken = await refreshAccessToken(client.googleAdsRefreshToken);
    if (accessToken !== client.googleAdsAccessToken) {
      await prisma.client.update({
        where: { id: clientId },
        data: { googleAdsAccessToken: accessToken },
      });
    }
  } catch (error: any) {
    const invalidGrant = isGoogleAdsInvalidGrant(error);
    const errMsg = String(error?.message || "unknown_error");

    if (invalidGrant) {
      googleAdsRevokedClientCache.set(clientId, Date.now());
      const respErr = error?.response?.data?.error;
      console.warn(
        `[Google Ads] Refresh token invalid (${respErr || errMsg}) for clientId=${clientId}. Marking Google Ads disconnected.`
      );
      try {
        await prisma.client.update({
          where: { id: clientId },
          data: {
            googleAdsAccessToken: null,
            googleAdsRefreshToken: null,
            googleAdsCustomerId: null,
            googleAdsConnectedAt: null,
          },
        });
      } catch (disconnectErr: any) {
        console.warn(
          `[Google Ads] Failed to mark clientId=${clientId} disconnected:`,
          disconnectErr?.message || disconnectErr
        );
      }
      throw new Error('Google Ads token expired or revoked. Please reconnect Google Ads.');
    }

    console.warn(
      `[Google Ads] Failed to refresh token for clientId=${clientId}: ${errMsg}`
    );
    throw new Error('Google Ads token refresh failed. Please reconnect Google Ads.');
  }

  const oauth2Client = getOAuth2Client();
  oauth2Client.setCredentials({
    access_token: accessToken,
    refresh_token: client.googleAdsRefreshToken,
  });

  return {
    oauth2Client,
    customerId: client.googleAdsCustomerId,
  };
}

/**
 * Check if Google Ads is connected for a client
 */
export async function isGoogleAdsConnected(clientId: string): Promise<boolean> {
  const client = await prisma.client.findUnique({
    where: { id: clientId },
    select: {
      googleAdsRefreshToken: true,
      googleAdsCustomerId: true,
      googleAdsConnectedAt: true,
    },
  });

  return !!(
    client?.googleAdsRefreshToken &&
    client?.googleAdsCustomerId &&
    client?.googleAdsConnectedAt
  );
}

/**
 * Normalize Google Ads searchStream response: can be a single object with results array
 * or an array of batch objects each with a results array.
 */
function getSearchStreamResults(data: any): any[] {
  if (!data) return [];
  if (Array.isArray(data)) {
    return data.flatMap((batch: any) => batch?.results || []);
  }
  return Array.isArray(data.results) ? data.results : [];
}

/**
 * Extract user-facing message from Google Ads API error response (403/401).
 * Prefers the specific error from details[].errors[] (e.g. CUSTOMER_NOT_ENABLED message).
 */
function getGoogleAdsErrorMessage(responseText: string): string {
  try {
    let err = typeof responseText === 'string' ? JSON.parse(responseText) : responseText;
    if (Array.isArray(err) && err[0]?.error) err = err[0];
    const topMsg = err?.error?.message ?? err?.message;
    const details = err?.error?.details ?? err?.details;
    if (Array.isArray(details) && details[0]?.errors?.[0]?.message) {
      return details[0].errors[0].message;
    }
    return typeof topMsg === 'string' ? topMsg : responseText;
  } catch {
    return responseText;
  }
}

/**
 * Get Google Ads API client using REST API
 */
async function getGoogleAdsApiClient(clientId: string) {
  const { oauth2Client, customerId } = await getGoogleAdsClient(clientId);
  
  if (!customerId) {
    throw new Error('Google Ads customer ID is not set');
  }
  const accessToken = oauth2Client.credentials.access_token;
  if (!accessToken) {
    throw new Error('Google Ads access token is not available. Please reconnect Google Ads.');
  }
  return {
    oauth2Client,
    customerId: customerId.replace(/-/g, ''), // Remove dashes from customer ID
    accessToken,
  };
}

/**
 * Get ordered list of accessible customer IDs (from listAccessibleCustomers).
 * First ID is typically the manager (MCC) when user has multiple accounts.
 * Used to set login-customer-id when accessing a child account.
 */
async function getAccessibleCustomerIds(clientId: string): Promise<string[]> {
  const { oauth2Client } = await getGoogleAdsClient(clientId);
  const accessToken = oauth2Client.credentials.access_token;
  if (!accessToken) return [];
  const apiUrl = 'https://googleads.googleapis.com/v20/customers:listAccessibleCustomers';
  const response = await fetch(apiUrl, {
    method: 'GET',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
      'developer-token': getGoogleAdsDeveloperToken(),
    },
  });
  if (!response.ok) return [];
  const data = await response.json();
  const resourceNames = data.resourceNames || [];
  return resourceNames.map((name: string) => {
    const m = name.match(/customers\/(\d+)/);
    return m ? m[1] : null;
  }).filter((id: string | null) => id !== null);
}

/** True if the response indicates "must set login-customer-id" / permission to access customer. */
function isLoginCustomerIdPermissionError(response: Response, responseText: string): boolean {
  if (response.status === 403) return true;
  const lower = responseText.toLowerCase();
  return (
    (lower.includes("permission") && (lower.includes("customer") || lower.includes("login-customer-id"))) ||
    lower.includes("login-customer-id") ||
    /caller does not have/i.test(responseText) ||
    /user doesn't have permission to access customer/i.test(responseText)
  );
}

/**
 * Run a Google Ads searchStream request with retry using login-customer-id when accessing a client via manager (MCC).
 * When the selected account is a client under an MCC, the API requires the manager's customer ID in the
 * 'login-customer-id' header. We try each accessible account as the manager until one succeeds.
 */
async function googleAdsSearchStream(
  clientId: string,
  customerId: string,
  accessToken: string,
  query: string
): Promise<{ response: Response; responseText: string }> {
  const apiUrl = `https://googleads.googleapis.com/v20/customers/${customerId}/googleAds:searchStream`;
  const body = JSON.stringify({ query });
  const selectedId = customerId.replace(/-/g, '');
  const doRequest = (loginCustomerId?: string) => {
    const headers: Record<string, string> = {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
      'developer-token': getGoogleAdsDeveloperToken(),
    };
    if (loginCustomerId) headers['login-customer-id'] = loginCustomerId;
    return fetch(apiUrl, { method: 'POST', headers, body });
  };

  let accessibleIds: string[] = [];
  try {
    accessibleIds = await getAccessibleCustomerIds(clientId);
  } catch {
    /* ignore; will try without header first */
  }

  // When we have multiple accounts and the selected one is in the list, the selected account may be a client.
  // Try each other accessible ID as login-customer-id (manager) so we always send the required header.
  const otherIds = accessibleIds.filter((id) => id !== selectedId);
  if (otherIds.length > 0 && accessibleIds.includes(selectedId)) {
    for (const loginId of otherIds) {
      const response = await doRequest(loginId);
      const responseText = await response.text();
      if (response.ok && !isLoginCustomerIdPermissionError(response, responseText)) {
        return { response, responseText };
      }
    }
  }

  // First request without login-customer-id (e.g. single account or selected is the manager)
  let response = await doRequest(undefined);
  let responseText = await response.text();

  // On permission error (403 or body message), retry with each other accessible customer as login-customer-id
  if (isLoginCustomerIdPermissionError(response, responseText)) {
    const ids = accessibleIds.length > 0 ? accessibleIds : await getAccessibleCustomerIds(clientId);
    for (const loginId of ids) {
      if (loginId === selectedId) continue;
      response = await doRequest(loginId);
      responseText = await response.text();
      if (response.ok && !isLoginCustomerIdPermissionError(response, responseText)) break;
    }
  }

  return { response, responseText };
}

/**
 * List Google Ads customer accounts (accessible accounts)
 */
export async function listGoogleAdsCustomers(clientId: string): Promise<Array<{
  customerId: string;
  customerName: string;
  currencyCode: string;
  timeZone: string;
}>> {
  try {
    // Use getGoogleAdsClient to get credentials with token refresh (same as other API calls).
    // It only requires refresh_token; customerId can be null when we're listing accounts.
    const { oauth2Client } = await getGoogleAdsClient(clientId);
    const accessToken = oauth2Client.credentials.access_token;

    if (!accessToken) {
      throw new Error('No access token available');
    }

    // Use Google Ads API to list accessible customers (v20)
    // Endpoint: GET https://googleads.googleapis.com/v20/customers:listAccessibleCustomers
    const apiUrl = 'https://googleads.googleapis.com/v20/customers:listAccessibleCustomers';
    const response = await fetch(apiUrl, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
        'developer-token': getGoogleAdsDeveloperToken(),
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('[Google Ads] List customers API error:', response.status, errorText);
      if (response.status === 401 || response.status === 403) {
        throw new Error('Google Ads API authentication failed. Please reconnect Google Ads.');
      }
      if (response.status === 400 && (errorText.includes('DEVELOPER_TOKEN_PARAMETER_MISSING') || errorText.includes('developer-token'))) {
        throw new Error(
          'Google Ads API requires a developer token. Set GOOGLE_ADS_DEVELOPER_TOKEN in server/.env and restart the server. Get the token from Google Ads: Tools & Settings → Setup → API Center.'
        );
      }
      return [];
    }

    const data = await response.json();
    const resourceNames = data.resourceNames || [];

    if (resourceNames.length === 0) {
      console.warn('[Google Ads] No accessible customers found');
      return [];
    }

    // Extract customer IDs from resource names (format: "customers/1234567890")
    const customerIds = resourceNames.map((resourceName: string) => {
      const match = resourceName.match(/customers\/(\d+)/);
      return match ? match[1] : null;
    }).filter((id: string | null) => id !== null);

    // Fetch details for each customer
    // Note: We'll use a simplified approach - fetch basic info for each customer
    const customers = await Promise.all(
      customerIds.map(async (customerId: string) => {
        try {
          // Try to fetch customer details using the CustomerService
          // Endpoint: GET https://googleads.googleapis.com/v20/customers/{customerId}
          const customerUrl = `https://googleads.googleapis.com/v20/customers/${customerId}`;
          const customerResponse = await fetch(customerUrl, {
            method: 'GET',
            headers: {
              'Authorization': `Bearer ${accessToken}`,
              'Content-Type': 'application/json',
              'developer-token': getGoogleAdsDeveloperToken(),
            },
          });

          if (customerResponse.ok) {
            const customerData = await customerResponse.json();
            return {
              customerId: customerId,
              customerName: customerData.descriptiveName || `Account ${customerId}`,
              currencyCode: customerData.currencyCode || 'USD',
              timeZone: customerData.timeZone || 'America/New_York',
            };
          } else {
            // If detailed fetch fails, return basic info
            const formattedId = customerId.length === 10 
              ? `${customerId.slice(0, 3)}-${customerId.slice(3, 6)}-${customerId.slice(6)}`
              : customerId;
            return {
              customerId: customerId,
              customerName: `Account ${formattedId}`,
              currencyCode: 'USD',
              timeZone: 'America/New_York',
            };
          }
        } catch (err: any) {
          console.warn(`[Google Ads] Failed to fetch details for customer ${customerId}:`, err.message);
          // Return basic info even if detail fetch fails
          const formattedId = customerId.length === 10 
            ? `${customerId.slice(0, 3)}-${customerId.slice(3, 6)}-${customerId.slice(6)}`
            : customerId;
          return {
            customerId: customerId,
            customerName: `Account ${formattedId}`,
            currencyCode: 'USD',
            timeZone: 'America/New_York',
          };
        }
      })
    );

    return customers;
  } catch (error: any) {
    console.error('[Google Ads] Failed to list customers:', error);
    
    // If error is about missing tokens, re-throw it
    if (error.message?.includes('No access token') || error.message?.includes('authentication failed')) {
      throw error;
    }
    
    // For other errors, return empty array - user can still connect manually
    return [];
  }
}

/**
 * List child (client) accounts under a manager (MCC) account.
 * Used when the user selects a manager so they can pick which client account to connect.
 * Query runs against the manager customer ID; no login-customer-id needed.
 */
export async function listChildAccountsUnderManager(
  clientId: string,
  managerCustomerId: string
): Promise<Array<{ customerId: string; customerName: string; status: string }>> {
  const { oauth2Client } = await getGoogleAdsClient(clientId);
  const accessToken = oauth2Client.credentials.access_token;
  if (!accessToken) {
    throw new Error('Google Ads access token is not available. Please reconnect Google Ads.');
  }
  const managerId = managerCustomerId.replace(/-/g, '');
  const apiUrl = `https://googleads.googleapis.com/v20/customers/${managerId}/googleAds:searchStream`;
  const query = `
    SELECT customer_client.id, customer_client.descriptive_name, customer_client.status
    FROM customer_client
    WHERE customer_client.status IN ('ENABLED', 'CANCELED')
      AND customer_client.manager = false
  `;
  const response = await fetch(apiUrl, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
      'developer-token': getGoogleAdsDeveloperToken(),
    },
    body: JSON.stringify({ query }),
  });
  const responseText = await response.text();
  if (!response.ok) {
    const detail = getGoogleAdsErrorMessage(responseText);
    if (response.status === 401 || response.status === 403) {
      throw new Error(detail);
    }
    throw new Error(`Google Ads API error (${response.status}): ${detail}`);
  }
  let data: any;
  try {
    data = JSON.parse(responseText);
  } catch {
    const batches = responseText.trim().split('\n').filter(Boolean).map((line: string) => {
      try { return JSON.parse(line); } catch { return null; }
    }).filter(Boolean);
    data = batches.length === 1 ? batches[0] : batches;
  }
  const results = getSearchStreamResults(data);
  return results.map((row: any) => {
    const id = row.customerClient?.id ?? row.customer_client?.id;
    const name = row.customerClient?.descriptiveName ?? row.customer_client?.descriptive_name ?? `Account ${id}`;
    const status = row.customerClient?.status ?? row.customer_client?.status ?? 'UNKNOWN';
    return {
      customerId: id != null ? String(id) : '',
      customerName: name,
      status: status,
    };
  }).filter((c: { customerId: string }) => c.customerId);
}

/**
 * Fetch Google Ads campaigns data using Google Ads API
 */
export async function fetchGoogleAdsCampaigns(
  clientId: string,
  startDate: Date,
  endDate: Date
): Promise<any> {
  try {
    const { customerId, accessToken } = await getGoogleAdsApiClient(clientId);
    
    // Format dates for API (YYYY-MM-DD)
    const startDateStr = startDate.toISOString().split('T')[0];
    const endDateStr = endDate.toISOString().split('T')[0];

    // Google Ads API query for campaigns with metrics
    const query = `
      SELECT
        campaign.id,
        campaign.name,
        campaign.status,
        metrics.clicks,
        metrics.impressions,
        metrics.cost_micros,
        metrics.conversions,
        metrics.conversions_value,
        metrics.average_cpc,
        metrics.ctr,
        metrics.search_impression_share,
        metrics.search_rank_lost_impression_share
      FROM campaign
      WHERE segments.date BETWEEN '${startDateStr}' AND '${endDateStr}'
      ORDER BY metrics.clicks DESC
    `;

    const { response, responseText } = await googleAdsSearchStream(clientId, customerId, accessToken, query);

    if (!response.ok) {
      console.error('[Google Ads] API error:', response.status, responseText);
      const detail = getGoogleAdsErrorMessage(responseText);
      if (response.status === 401 || response.status === 403) {
        throw new Error(detail);
      }
      throw new Error(`Google Ads API error (${response.status}): ${detail}`);
    }

    let data: any;
    try {
      data = JSON.parse(responseText);
    } catch {
      // Some responses may be NDJSON (newline-delimited JSON)
      const batches = responseText.trim().split('\n').filter(Boolean).map((line) => {
        try {
          return JSON.parse(line);
        } catch {
          return null;
        }
      }).filter(Boolean);
      data = batches.length === 1 ? batches[0] : batches;
    }
    const results = getSearchStreamResults(data);

    // Parse the response
    const campaigns: any[] = [];
    let totalClicks = 0;
    let totalImpressions = 0;
    let totalCostMicros = 0;
    let totalConversions = 0;

    if (results.length > 0) {
      // Group by campaign (since we're querying by date range, we may have multiple rows per campaign)
      const campaignMap = new Map<string, any>();

      for (const row of results) {
        const campaignId = row.campaign?.id?.toString() || 'unknown';
        const campaignName = row.campaign?.name || 'Unnamed Campaign';
        // Google Ads API returns metrics in camelCase format
        const clicks = parseInt(row.metrics?.clicks || row.metrics?.clicks || '0', 10);
        const impressions = parseInt(row.metrics?.impressions || '0', 10);
        // cost_micros becomes costMicros in JSON response
        const costMicros = parseInt(row.metrics?.costMicros || row.metrics?.cost_micros || '0', 10);
        const conversions = parseFloat(row.metrics?.conversions || '0');
        // average_cpc becomes averageCpc, and it's a Money object with micros field
        const avgCpcMicros = row.metrics?.averageCpc?.micros || row.metrics?.average_cpc?.micros || 0;
        const avgCpc = typeof avgCpcMicros === 'number' ? avgCpcMicros / 1000000 : parseFloat(row.metrics?.averageCpc || row.metrics?.average_cpc || '0');
        const ctr = parseFloat(row.metrics?.ctr || '0');

        if (!campaignMap.has(campaignId)) {
          campaignMap.set(campaignId, {
            id: campaignId,
            name: campaignName,
            status: row.campaign?.status || 'UNKNOWN',
            clicks: 0,
            impressions: 0,
            cost: 0,
            conversions: 0,
            avgCpc: 0,
            ctr: 0,
          });
        }

        const campaign = campaignMap.get(campaignId)!;
        campaign.clicks += clicks;
        campaign.impressions += impressions;
        campaign.cost += costMicros / 1000000; // Convert micros to dollars
        campaign.conversions += conversions;
        campaign.avgCpc = avgCpc || (campaign.cost / campaign.clicks || 0);
        campaign.ctr = ctr || (campaign.clicks / campaign.impressions || 0);

        totalClicks += clicks;
        totalImpressions += impressions;
        totalCostMicros += costMicros;
        totalConversions += conversions;
      }

      campaigns.push(...Array.from(campaignMap.values()));
    }

    // Calculate summary metrics
    const totalCost = totalCostMicros / 1000000;
    const avgCpc = totalClicks > 0 ? totalCost / totalClicks : 0;
    const conversionRate = totalClicks > 0 ? (totalConversions / totalClicks) * 100 : 0;
    const costPerConversion = totalConversions > 0 ? totalCost / totalConversions : 0;

    return {
      campaigns: campaigns.sort((a, b) => b.clicks - a.clicks),
      summary: {
        clicks: totalClicks,
        impressions: totalImpressions,
        cost: totalCost,
        conversions: totalConversions,
        conversionRate: conversionRate,
        avgCpc: avgCpc,
        costPerConversion: costPerConversion,
      },
    };
  } catch (error: any) {
    console.error('[Google Ads] Failed to fetch campaigns:', error);
    throw error;
  }
}

/**
 * Fetch Google Ads ad groups data
 */
export async function fetchGoogleAdsAdGroups(
  clientId: string,
  startDate: Date,
  endDate: Date,
  campaignId?: string
): Promise<any> {
  try {
    const { customerId, accessToken } = await getGoogleAdsApiClient(clientId);
    
    const startDateStr = startDate.toISOString().split('T')[0];
    const endDateStr = endDate.toISOString().split('T')[0];

    let query = `
      SELECT
        ad_group.id,
        ad_group.name,
        ad_group.status,
        campaign.id,
        campaign.name,
        metrics.clicks,
        metrics.impressions,
        metrics.cost_micros,
        metrics.conversions,
        metrics.average_cpc,
        metrics.ctr
      FROM ad_group
      WHERE segments.date BETWEEN '${startDateStr}' AND '${endDateStr}'
    `;

    if (campaignId) {
      query += ` AND campaign.id = ${campaignId}`;
    }

    query += ` ORDER BY metrics.clicks DESC`;

    const { response, responseText } = await googleAdsSearchStream(clientId, customerId, accessToken, query);
    if (!response.ok) {
      const detail = getGoogleAdsErrorMessage(responseText);
      throw new Error(response.status === 401 || response.status === 403 ? detail : `Google Ads API error: ${response.status} ${detail}`);
    }

    let data: any;
    try {
      data = JSON.parse(responseText);
    } catch {
      const batches = responseText.trim().split('\n').filter(Boolean).map((line) => {
        try { return JSON.parse(line); } catch { return null; }
      }).filter(Boolean);
      data = batches.length === 1 ? batches[0] : batches;
    }
    const results = getSearchStreamResults(data);
    const adGroups: any[] = [];
    const adGroupMap = new Map<string, any>();

    if (results.length > 0) {
      for (const row of results) {
        const adGroupId = row.adGroup?.id?.toString() || 'unknown';
        const adGroupName = row.adGroup?.name || 'Unnamed Ad Group';
        const campaignName = row.campaign?.name || 'Unknown Campaign';

        if (!adGroupMap.has(adGroupId)) {
          adGroupMap.set(adGroupId, {
            id: adGroupId,
            name: adGroupName,
            campaignName: campaignName,
            status: row.adGroup?.status || 'UNKNOWN',
            clicks: 0,
            impressions: 0,
            cost: 0,
            conversions: 0,
            avgCpc: 0,
            ctr: 0,
          });
        }

        const adGroup = adGroupMap.get(adGroupId)!;
        adGroup.clicks += parseInt(row.metrics?.clicks || '0', 10);
        adGroup.impressions += parseInt(row.metrics?.impressions || '0', 10);
        const costMicros = parseInt(row.metrics?.costMicros || row.metrics?.cost_micros || '0', 10);
        adGroup.cost += costMicros / 1000000;
        adGroup.conversions += parseFloat(row.metrics?.conversions || '0');
        const avgCpcMicros = row.metrics?.averageCpc?.micros || row.metrics?.average_cpc?.micros || 0;
        adGroup.avgCpc = typeof avgCpcMicros === 'number' ? avgCpcMicros / 1000000 : parseFloat(row.metrics?.averageCpc || row.metrics?.average_cpc || '0');
        adGroup.ctr = parseFloat(row.metrics?.ctr || '0');
      }

      adGroups.push(...Array.from(adGroupMap.values()));
    }

    return {
      adGroups: adGroups.sort((a, b) => b.clicks - a.clicks),
    };
  } catch (error: any) {
    console.error('[Google Ads] Failed to fetch ad groups:', error);
    return {
      adGroups: [],
      error: error.message,
    };
  }
}

/**
 * Fetch Google Ads keywords data
 */
export async function fetchGoogleAdsKeywords(
  clientId: string,
  startDate: Date,
  endDate: Date,
  campaignId?: string,
  adGroupId?: string
): Promise<any> {
  try {
    const { customerId, accessToken } = await getGoogleAdsApiClient(clientId);
    
    const startDateStr = startDate.toISOString().split('T')[0];
    const endDateStr = endDate.toISOString().split('T')[0];

    let query = `
      SELECT
        ad_group_criterion.keyword.text,
        ad_group_criterion.keyword.match_type,
        ad_group_criterion.status,
        ad_group.id,
        ad_group.name,
        campaign.id,
        campaign.name,
        metrics.clicks,
        metrics.impressions,
        metrics.cost_micros,
        metrics.conversions,
        metrics.average_cpc,
        metrics.ctr,
        metrics.search_impression_share,
        metrics.search_rank_lost_impression_share
      FROM keyword_view
      WHERE segments.date BETWEEN '${startDateStr}' AND '${endDateStr}'
        AND ad_group_criterion.type = 'KEYWORD'
    `;

    if (campaignId) {
      query += ` AND campaign.id = ${campaignId}`;
    }
    if (adGroupId) {
      query += ` AND ad_group.id = ${adGroupId}`;
    }

    query += ` ORDER BY metrics.clicks DESC LIMIT 1000`;

    const { response, responseText } = await googleAdsSearchStream(clientId, customerId, accessToken, query);
    if (!response.ok) {
      const detail = getGoogleAdsErrorMessage(responseText);
      throw new Error(response.status === 401 || response.status === 403 ? detail : `Google Ads API error: ${response.status} ${detail}`);
    }

    let data: any;
    try {
      data = JSON.parse(responseText);
    } catch {
      const batches = responseText.trim().split('\n').filter(Boolean).map((line) => {
        try { return JSON.parse(line); } catch { return null; }
      }).filter(Boolean);
      data = batches.length === 1 ? batches[0] : batches;
    }
    const results = getSearchStreamResults(data);
    const keywords: any[] = [];
    const keywordMap = new Map<string, any>();

    if (results.length > 0) {
      for (const row of results) {
        const keywordText = row.adGroupCriterion?.keyword?.text || row.ad_group_criterion?.keyword?.text || 'Unknown';
        const matchType = row.adGroupCriterion?.keyword?.matchType || row.ad_group_criterion?.keyword?.match_type || 'UNKNOWN';
        const key = `${keywordText}_${matchType}`;

        if (!keywordMap.has(key)) {
          keywordMap.set(key, {
            keyword: keywordText,
            matchType: matchType,
            status: row.adGroupCriterion?.status || 'UNKNOWN',
            adGroupName: row.adGroup?.name || 'Unknown',
            campaignName: row.campaign?.name || 'Unknown',
            clicks: 0,
            impressions: 0,
            cost: 0,
            conversions: 0,
            avgCpc: 0,
            ctr: 0,
            impressionShare: 0,
          });
        }

        const keyword = keywordMap.get(key)!;
        keyword.clicks += parseInt(row.metrics?.clicks || '0', 10);
        keyword.impressions += parseInt(row.metrics?.impressions || '0', 10);
        const costMicros = parseInt(row.metrics?.costMicros || row.metrics?.cost_micros || '0', 10);
        keyword.cost += costMicros / 1000000;
        keyword.conversions += parseFloat(row.metrics?.conversions || '0');
        const avgCpcMicros = row.metrics?.averageCpc?.micros || row.metrics?.average_cpc?.micros || 0;
        keyword.avgCpc = typeof avgCpcMicros === 'number' ? avgCpcMicros / 1000000 : parseFloat(row.metrics?.averageCpc || row.metrics?.average_cpc || '0');
        keyword.ctr = parseFloat(row.metrics?.ctr || '0');
        keyword.impressionShare = parseFloat(row.metrics?.searchImpressionShare || row.metrics?.search_impression_share || '0');
      }

      keywords.push(...Array.from(keywordMap.values()));
    }

    return {
      keywords: keywords.sort((a, b) => b.clicks - a.clicks),
    };
  } catch (error: any) {
    console.error('[Google Ads] Failed to fetch keywords:', error);
    return {
      keywords: [],
      error: error.message,
    };
  }
}

/**
 * Fetch Google Ads conversions data
 */
export async function fetchGoogleAdsConversions(
  clientId: string,
  startDate: Date,
  endDate: Date
): Promise<any> {
  try {
    const { customerId, accessToken } = await getGoogleAdsApiClient(clientId);
    
    const startDateStr = startDate.toISOString().split('T')[0];
    const endDateStr = endDate.toISOString().split('T')[0];

    // Query for conversion actions and their performance
    const query = `
      SELECT
        segments.date,
        segments.conversion_action_name,
        segments.conversion_action,
        campaign.id,
        campaign.name,
        metrics.conversions,
        metrics.conversions_value,
        metrics.cost_micros,
        metrics.clicks
      FROM conversion_action
      WHERE segments.date BETWEEN '${startDateStr}' AND '${endDateStr}'
        AND metrics.conversions > 0
      ORDER BY segments.date DESC, metrics.conversions DESC
    `;

    const { response, responseText } = await googleAdsSearchStream(clientId, customerId, accessToken, query);
    if (!response.ok) {
      const detail = getGoogleAdsErrorMessage(responseText);
      throw new Error(response.status === 401 || response.status === 403 ? detail : `Google Ads API error: ${response.status} ${detail}`);
    }

    let data: any;
    try {
      data = JSON.parse(responseText);
    } catch {
      const batches = responseText.trim().split('\n').filter(Boolean).map((line) => {
        try { return JSON.parse(line); } catch { return null; }
      }).filter(Boolean);
      data = batches.length === 1 ? batches[0] : batches;
    }
    const results = getSearchStreamResults(data);
    const conversions: any[] = [];
    let totalConversions = 0;
    let totalConversionValue = 0;
    let totalClicks = 0;
    let totalCost = 0;

    if (results.length > 0) {
      for (const row of results) {
        const conversionName = row.segments?.conversionActionName || row.segments?.conversion_action_name || 'Unknown Conversion';
        const date = row.segments?.date || '';
        const campaignName = row.campaign?.name || 'Unknown Campaign';
        const conversionsCount = parseFloat(row.metrics?.conversions || '0');
        const conversionValue = parseFloat(row.metrics?.conversionsValue || row.metrics?.conversions_value || '0');
        const costMicros = parseInt(row.metrics?.costMicros || row.metrics?.cost_micros || '0', 10);
        const cost = costMicros / 1000000;
        const clicks = parseInt(row.metrics?.clicks || '0', 10);

        conversions.push({
          date: date,
          conversionAction: conversionName,
          campaignName: campaignName,
          conversions: conversionsCount,
          conversionValue: conversionValue,
          cost: cost,
          clicks: clicks,
          costPerConversion: conversionsCount > 0 ? cost / conversionsCount : 0,
        });

        totalConversions += conversionsCount;
        totalConversionValue += conversionValue;
        totalClicks += clicks;
        totalCost += cost;
      }
    }

    const conversionRate = totalClicks > 0 ? (totalConversions / totalClicks) * 100 : 0;

    return {
      conversions: conversions.sort((a, b) => {
        // Sort by date descending, then by conversions descending
        if (a.date !== b.date) {
          return b.date.localeCompare(a.date);
        }
        return b.conversions - a.conversions;
      }),
      summary: {
        totalConversions: totalConversions,
        conversionValue: totalConversionValue,
        conversionRate: conversionRate,
        totalClicks: totalClicks,
        totalCost: totalCost,
        costPerConversion: totalConversions > 0 ? totalCost / totalConversions : 0,
      },
    };
  } catch (error: any) {
    console.error('[Google Ads] Failed to fetch conversions:', error);
    return {
      conversions: [],
      summary: {
        totalConversions: 0,
        conversionValue: 0,
        conversionRate: 0,
        totalClicks: 0,
        totalCost: 0,
        costPerConversion: 0,
      },
      error: error.message,
    };
  }
}
