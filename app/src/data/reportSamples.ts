export const sampleReports = [
  { name: "Jan", totalVisitors: 4000, organicTraffic: 3200, firstTimeVisitors: 2400, engagedVisitors: 1600, newUsers: 2400, totalUsers: 4000 },
  { name: "Feb", totalVisitors: 3800, organicTraffic: 3000, firstTimeVisitors: 2280, engagedVisitors: 1520, newUsers: 2280, totalUsers: 3800 },
  { name: "Mar", totalVisitors: 4200, organicTraffic: 3400, firstTimeVisitors: 2520, engagedVisitors: 1680, newUsers: 2520, totalUsers: 4200 },
  { name: "Apr", totalVisitors: 4500, organicTraffic: 3600, firstTimeVisitors: 2700, engagedVisitors: 1800, newUsers: 2700, totalUsers: 4500 },
  { name: "May", totalVisitors: 4800, organicTraffic: 3900, firstTimeVisitors: 2880, engagedVisitors: 1920, newUsers: 2880, totalUsers: 4800 },
  { name: "Jun", totalVisitors: 5200, organicTraffic: 4200, firstTimeVisitors: 3120, engagedVisitors: 2080, newUsers: 3120, totalUsers: 5200 },
];

export const trafficSourceData = [
  { name: "Organic", value: 65, color: "#10B981" },
  { name: "Direct", value: 20, color: "#3B82F6" },
  { name: "Referral", value: 10, color: "#F59E0B" },
  { name: "Paid", value: 5, color: "#EF4444" },
];

export const visitorSourceData = [
  { source: "google.com", visitors: 2320, sessions: 232, keyEvents: 15.0, eventCount: 1061 },
  { source: "bing.com", visitors: 1200, sessions: 200, keyEvents: 14.0, eventCount: 809 },
  { source: "yahoo.com", visitors: 800, sessions: 140, keyEvents: 9.0, eventCount: 532 },
  { source: "duckduckgo.com", visitors: 300, sessions: 30, keyEvents: 4.0, eventCount: 120 },
];

export const topPagesData = [
  { page: "/", visitors: 890, totalUsers: 864, userEngagement: "1d 12h 15m 45s", avgTime: "2m 30s" },
  { page: "/services/", visitors: 334, totalUsers: 436, userEngagement: "35m 45s", avgTime: "1m 45s" },
  { page: "/about-us/", visitors: 157, totalUsers: 124, userEngagement: "14m 22s", avgTime: "1m 20s" },
  { page: "/contact/", visitors: 43, totalUsers: 56, userEngagement: "5m", avgTime: "45s" },
];

export const eventsData = [
  { name: "Page Views", count: 15420, change: "+12%" },
  { name: "Downloads", count: 234, change: "+8%" },
  { name: "Form Submissions", count: 89, change: "+15%" },
  { name: "Video Plays", count: 456, change: "+22%" },
];

export const conversionsData = [
  { name: "Leads Generated", count: 45, change: "+18%" },
  { name: "Phone Calls", count: 23, change: "+5%" },
  { name: "Email Signups", count: 67, change: "+12%" },
  { name: "Quote Requests", count: 34, change: "+8%" },
];

export const targetKeywordsData = [
  { keyword: "seo services chicago", location: "Chicago, IL", googleRank: 3, change: "+2", serpFeatures: ["Local Pack", "Reviews"], url: "https://example.com/seo-services" },
  { keyword: "digital marketing agency", location: "United States", googleRank: 8, change: "-1", serpFeatures: ["Sitelinks"], url: "https://example.com/digital-marketing" },
  { keyword: "content marketing strategy", location: "United States", googleRank: 12, change: "+3", serpFeatures: ["Featured Snippet"], url: "https://example.com/content-marketing" },
  { keyword: "local seo expert", location: "Chicago, IL", googleRank: 5, change: "+1", serpFeatures: ["Local Pack"], url: "https://example.com/local-seo" },
  { keyword: "link building services", location: "United States", googleRank: 15, change: "-2", serpFeatures: [], url: "https://example.com/link-building" },
];

export const backlinksData = [
  { source: "example.com", anchorText: "best seo services", domainRating: 85, publishDate: "2024-10-15", manuallyCreated: true },
  { source: "techblog.com", anchorText: "digital marketing tips", domainRating: 75, publishDate: "2024-10-12", manuallyCreated: true },
  { source: "businessnews.com", anchorText: "seo company", domainRating: 90, publishDate: "2024-10-10", manuallyCreated: false },
  { source: "startupguide.com", anchorText: "marketing strategies", domainRating: 60, publishDate: "2024-10-08", manuallyCreated: true },
];

export const workLogData = [
  { date: "2024-10-15", workType: "On-Page SEO", description: "Optimized title tags and meta descriptions for homepage", status: "Completed" },
  { date: "2024-10-14", workType: "Content", description: "Created 5 new blog posts targeting long-tail keywords", status: "Completed" },
  { date: "2024-10-13", workType: "Technical", description: "Fixed mobile responsiveness issues on product pages", status: "In Progress" },
  { date: "2024-10-12", workType: "Link Building", description: "Reached out to 10 industry blogs for guest posting", status: "Pending" },
];

