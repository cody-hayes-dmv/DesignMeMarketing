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

/**
 * Get OAuth2 client for Google Ads
 */
function getOAuth2Client() {
  const clientId = process.env.GOOGLE_ADS_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_ADS_CLIENT_SECRET;
  const redirectUri = process.env.GOOGLE_ADS_REDIRECT_URI || 'http://localhost:5000/api/clients/google-ads/callback';

  if (!clientId || !clientSecret) {
    const errorMsg = 'Google Ads credentials not configured. Please set GOOGLE_ADS_CLIENT_ID and GOOGLE_ADS_CLIENT_SECRET environment variables in server/.env file.\n\n' +
      'Required variables:\n' +
      '  GOOGLE_ADS_CLIENT_ID=your_client_id.apps.googleusercontent.com\n' +
      '  GOOGLE_ADS_CLIENT_SECRET=your_client_secret\n' +
      '  GOOGLE_ADS_REDIRECT_URI=http://localhost:5000/api/clients/google-ads/callback\n\n' +
      'See Google Ads API documentation for setup instructions.';
    throw new Error(errorMsg);
  }

  return new google.auth.OAuth2(clientId, clientSecret, redirectUri);
}

/**
 * Get Google Ads authorization URL for OAuth flow
 */
export function getGoogleAdsAuthUrl(clientId: string): string {
  const oauth2Client = getOAuth2Client();
  const scopes = [
    'https://www.googleapis.com/auth/adwords', // Google Ads API scope
    'https://www.googleapis.com/auth/userinfo.email', // Required to get user email
  ];

  const redirectUri = process.env.GOOGLE_ADS_REDIRECT_URI || `${process.env.BACKEND_URL || 'http://localhost:5000'}/api/clients/google-ads/callback`;

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
  
  const redirectUri = process.env.GOOGLE_ADS_REDIRECT_URI || `${process.env.BACKEND_URL || 'http://localhost:5000'}/api/clients/google-ads/callback`;
  
  let tokens;
  try {
    const tokenResponse = await oauth2Client.getToken(code);
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
      console.warn(
        `[Google Ads] Refresh token invalid_grant for clientId=${clientId}. Marking Google Ads disconnected.`
      );
      try {
        await prisma.client.update({
          where: { id: clientId },
          data: {
            googleAdsAccessToken: null,
            googleAdsRefreshToken: null,
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
 * Get Google Ads API client using REST API
 */
async function getGoogleAdsApiClient(clientId: string) {
  const { oauth2Client, customerId } = await getGoogleAdsClient(clientId);
  
  if (!customerId) {
    throw new Error('Google Ads customer ID is not set');
  }

  // Google Ads API uses REST endpoints
  // We'll use the googleapis library to make authenticated requests
  return {
    oauth2Client,
    customerId: customerId.replace(/-/g, ''), // Remove dashes from customer ID
    accessToken: oauth2Client.credentials.access_token,
  };
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
    const { oauth2Client } = await getGoogleAdsClient(clientId);
    const accessToken = oauth2Client.credentials.access_token;

    // Use Google Ads API to list accessible customers
    // Note: This requires a developer token, but we'll try without it first
    // The customer service endpoint: https://googleads.googleapis.com/v16/customers/{customerId}/googleAds:search
    
    // For listing accessible customers, we use the CustomerService
    // However, without a developer token, we can't use the full API
    // We'll return the connected customer ID as a workaround
    const client = await prisma.client.findUnique({
      where: { id: clientId },
      select: { googleAdsCustomerId: true },
    });

    if (!client?.googleAdsCustomerId) {
      return [];
    }

    // Format customer ID (add dashes for display)
    const customerId = client.googleAdsCustomerId;
    const formattedId = customerId.length === 10 
      ? `${customerId.slice(0, 3)}-${customerId.slice(3, 6)}-${customerId.slice(6)}`
      : customerId;

    // Try to fetch customer details
    // Note: This is a simplified implementation
    // Full implementation would require developer token and use the Google Ads API client library
    return [{
      customerId: customerId,
      customerName: `Account ${formattedId}`,
      currencyCode: 'USD', // Default, would be fetched from API
      timeZone: 'America/New_York', // Default, would be fetched from API
    }];
  } catch (error: any) {
    console.error('[Google Ads] Failed to list customers:', error);
    // Return empty array on error - user can still connect manually
    return [];
  }
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

    // Use Google Ads API REST endpoint (v22 is current, but v16 should still work)
    const apiUrl = `https://googleads.googleapis.com/v16/customers/${customerId}/googleAds:searchStream`;
    
    // Build headers - developer token is optional
    const headers: Record<string, string> = {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    };
    
    // Only add developer token if it's set
    if (process.env.GOOGLE_ADS_DEVELOPER_TOKEN) {
      headers['developer-token'] = process.env.GOOGLE_ADS_DEVELOPER_TOKEN;
    }
    
    const response = await fetch(apiUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        query: query,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('[Google Ads] API error:', response.status, errorText);
      
      // Handle authentication errors
      if (response.status === 401 || response.status === 403) {
        // Check if it's a developer token issue
        if (!process.env.GOOGLE_ADS_DEVELOPER_TOKEN) {
          throw new Error('Google Ads API requires a developer token. Please set GOOGLE_ADS_DEVELOPER_TOKEN in your .env file. You can get a developer token from your Google Ads account: Tools & Settings > API Center.');
        }
        throw new Error('Google Ads API authentication failed. Please check your OAuth credentials and developer token.');
      }
      
      throw new Error(`Google Ads API error: ${response.status} ${errorText}`);
    }

    const data = await response.json();
    
    // Parse the response
    const campaigns: any[] = [];
    let totalClicks = 0;
    let totalImpressions = 0;
    let totalCostMicros = 0;
    let totalConversions = 0;

    if (data.results && Array.isArray(data.results)) {
      // Group by campaign (since we're querying by date range, we may have multiple rows per campaign)
      const campaignMap = new Map<string, any>();

      for (const row of data.results) {
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
    
    // Return empty data structure on error
    return {
      campaigns: [],
      summary: {
        clicks: 0,
        impressions: 0,
        cost: 0,
        conversions: 0,
        conversionRate: 0,
        avgCpc: 0,
        costPerConversion: 0,
      },
      error: error.message,
    };
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

    const apiUrl = `https://googleads.googleapis.com/v16/customers/${customerId}/googleAds:searchStream`;
    
    // Build headers - developer token is optional
    const headers: Record<string, string> = {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    };
    
    // Only add developer token if it's set
    if (process.env.GOOGLE_ADS_DEVELOPER_TOKEN) {
      headers['developer-token'] = process.env.GOOGLE_ADS_DEVELOPER_TOKEN;
    }
    
    const response = await fetch(apiUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify({ query }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Google Ads API error: ${response.status} ${errorText}`);
    }

    const data = await response.json();
    const adGroups: any[] = [];
    const adGroupMap = new Map<string, any>();

    if (data.results && Array.isArray(data.results)) {
      for (const row of data.results) {
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

    const apiUrl = `https://googleads.googleapis.com/v16/customers/${customerId}/googleAds:searchStream`;
    
    // Build headers - developer token is optional
    const headers: Record<string, string> = {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    };
    
    // Only add developer token if it's set
    if (process.env.GOOGLE_ADS_DEVELOPER_TOKEN) {
      headers['developer-token'] = process.env.GOOGLE_ADS_DEVELOPER_TOKEN;
    }
    
    const response = await fetch(apiUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify({ query }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Google Ads API error: ${response.status} ${errorText}`);
    }

    const data = await response.json();
    const keywords: any[] = [];
    const keywordMap = new Map<string, any>();

    if (data.results && Array.isArray(data.results)) {
      for (const row of data.results) {
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

    const apiUrl = `https://googleads.googleapis.com/v16/customers/${customerId}/googleAds:searchStream`;
    
    // Build headers - developer token is optional
    const headers: Record<string, string> = {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    };
    
    // Only add developer token if it's set
    if (process.env.GOOGLE_ADS_DEVELOPER_TOKEN) {
      headers['developer-token'] = process.env.GOOGLE_ADS_DEVELOPER_TOKEN;
    }
    
    const response = await fetch(apiUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify({ query }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Google Ads API error: ${response.status} ${errorText}`);
    }

    const data = await response.json();
    const conversions: any[] = [];
    let totalConversions = 0;
    let totalConversionValue = 0;
    let totalClicks = 0;
    let totalCost = 0;

    if (data.results && Array.isArray(data.results)) {
      for (const row of data.results) {
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
