import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

async function main() {
  console.log("🌱 Starting database seeding...");

  // Clear existing data (optional - remove if you want to keep existing data)
  await prisma.token.deleteMany();
  await prisma.task.deleteMany();
  await prisma.userAgency.deleteMany();
  await prisma.agency.deleteMany();
  await prisma.client.deleteMany();
  await prisma.user.deleteMany();

  // Hash passwords
  const hashedPassword = await bcrypt.hash("123123", 12);

  // 0. Create Super Admin User
  const superAdminUser = await prisma.user.create({
    data: {
      name: "SuperAdmin",
      email: "super@super.com",
      passwordHash: hashedPassword,
      role: "SUPER_ADMIN",
      verified: true,
      invited: false,
    },
  });

  console.log("✅ Created Super Admin user:", superAdminUser.email);

  // 1. Create Admin User
  const adminUser = await prisma.user.create({
    data: {
      name: "Admin",
      email: "admin@admin.com",
      passwordHash: hashedPassword,
      role: "ADMIN",
      verified: true,
      invited: false,
    },
  });

  console.log("✅ Created Admin user:", adminUser.email);

  // 2. Create Agency and Agency Owner
  const agencyUser = await prisma.user.create({
    data: {
      name: "Acme Agency",
      email: "acme@acme.com",
      passwordHash: hashedPassword,
      role: "AGENCY",
      verified: true,
      invited: false,
    },
  });

  const acmeAgency = await prisma.agency.create({
    data: {
      name: "Acme Agency",
      subdomain: "acme",
    },
  });

  const superAdminAgency = await prisma.agency.create({
    data: {
      name: "Super Agency",
      subdomain: "super",
    },
  });

  // Link agency user to agency
  await prisma.userAgency.create({
    data: {
      userId: superAdminUser.id,
      agencyId: superAdminAgency.id,
      agencyRole: "OWNER", // Owner role
    },
  });

  await prisma.userAgency.create({
    data: {
      userId: agencyUser.id,
      agencyId: acmeAgency.id,
      agencyRole: "OWNER", // Owner role
    },
  });

  console.log("✅ Created Agency:", acmeAgency.name, ",", superAdminAgency.name);
  console.log("✅ Created Agency user:", agencyUser.email);

  // 3. Create Worker User
  const acmeWorker = await prisma.user.create({
    data: {
      name: "Worker",
      email: "worker@acme.com",
      passwordHash: hashedPassword,
      role: "WORKER",
      verified: true, // All users should be verified
      invited: true, // Worker was invited
    },
  });

  const acmeWorker1 = await prisma.user.create({
    data: {
      name: "Worker1",
      email: "worker1@acme.com",
      passwordHash: hashedPassword,
      role: "WORKER",
      verified: true, // All users should be verified
      invited: true, // Worker was invited
    },
  });

  const superAdminWorker = await prisma.user.create({
    data: {
      name: "Worker3",
      email: "superworker@super.com",
      passwordHash: hashedPassword,
      role: "WORKER",
      verified: true, // All users should be verified
      invited: true, // Worker was invited
    },
  });

  // Link worker to agency
  await prisma.userAgency.create({
    data: {
      userId: acmeWorker.id,
      agencyId: acmeAgency.id,
      agencyRole: "WORKER",
    },
  });

  await prisma.userAgency.create({
    data: {
      userId: acmeWorker1.id,
      agencyId: acmeAgency.id,
      agencyRole: "WORKER",
    },
  });

  await prisma.userAgency.create({
    data: {
      userId: superAdminWorker.id,
      agencyId: superAdminAgency.id,
      agencyRole: "WORKER",
    },
  });

  console.log("✅ Created Worker users:", acmeWorker.email, acmeWorker1.email, superAdminWorker.email);

  // Create sample client
  const superAdminClient = await prisma.client.create({
    data: {
      name: "Acme Co",
      domain: "acme.example",
      industry: "E-commerce",
      targets: JSON.stringify(["US / Chicago"]),
      loginUrl: "https://acme.example/wp-admin",
      username: "admin@acme.example",
      password: "Acme2024!",
      notes: "Main admin access. Contact IT for 2FA reset.",
      userId: superAdminUser.id,
    }
  });

  const acmeClient = await prisma.client.create({
    data: {
      name: "Beta Soft",
      domain: "beta.example",
      industry: "SaaS",
      targets: JSON.stringify(["US / Remote"]),
      loginUrl: "https://beta.example/login",
      username: "seo@beta.example",
      password: "BetaSEO2024!",
      notes: "SEO dashboard access. Check with client for any password changes.",
      userId: agencyUser.id,
    }
  });

  const acmeClient1 = await prisma.client.create({
    data: {
      name: "Nimbus Health",
      domain: "nimbus.example",
      industry: "Healthcare",
      targets: JSON.stringify(["US / NY", "US / NJ"]),
      loginUrl: "https://nimbus.example/admin",
      username: "healthcare@nimbus.example",
      password: "Nimbus2024!",
      notes: "Healthcare client - HIPAA compliance required. Use secure connection only.",
      userId: agencyUser.id,
    }
  });

  console.log("✅ Created sample clients");

  // Create onboarding templates
  const defaultTemplate = await prisma.onboardingTemplate.create({
    data: {
      name: "Standard SEO Onboarding",
      description: "Default template for new SEO clients",
      isDefault: true,
      agencyId: acmeAgency.id,
    }
  });

  // Add onboarding tasks to the template
  const onboardingTasks = [
    {
      title: "Website Audit",
      description: "Complete technical SEO audit of the website",
      category: "Technical SEO",
      priority: "high",
      estimatedHours: 4,
      order: 1,
    },
    {
      title: "Keyword Research",
      description: "Research and identify target keywords",
      category: "Research",
      priority: "high",
      estimatedHours: 3,
      order: 2,
    },
    {
      title: "Competitor Analysis",
      description: "Analyze top 5 competitors and their strategies",
      category: "Research",
      priority: "medium",
      estimatedHours: 2,
      order: 3,
    },
    {
      title: "Google Analytics Setup",
      description: "Install and configure Google Analytics and Search Console",
      category: "Setup",
      priority: "high",
      estimatedHours: 1,
      order: 4,
    },
    {
      title: "Meta Tags Optimization",
      description: "Optimize title tags, meta descriptions, and headers",
      category: "On-Page SEO",
      priority: "medium",
      estimatedHours: 2,
      order: 5,
    },
    {
      title: "Content Strategy",
      description: "Develop content strategy and editorial calendar",
      category: "Content",
      priority: "medium",
      estimatedHours: 3,
      order: 6,
    },
    {
      title: "Local SEO Setup",
      description: "Set up Google My Business and local citations",
      category: "Local SEO",
      priority: "low",
      estimatedHours: 2,
      order: 7,
    },
  ];

  for (const task of onboardingTasks) {
    await prisma.onboardingTask.create({
      data: {
        ...task,
        templateId: defaultTemplate.id,
      }
    });
  }

  console.log("✅ Created onboarding template with tasks");

  // Create some sample tasks
  await prisma.task.create({
    data: {
      title: "Setup SEO audit for new client",
      description:
        "Perform comprehensive SEO audit for the new e-commerce client",
      category: "On-page",
      status: "TODO",
      agencyId: acmeAgency.id,
      createdById: agencyUser.id,
      assigneeId: acmeWorker.id,
      clientId: acmeClient.id
    },
  });

  await prisma.task.create({
    data: {
      title: "Keyword research for tech blog",
      description:
        "Research high-volume keywords for the technology blog project",
      category: "Content",
      status: "IN_PROGRESS",
      agencyId: acmeAgency.id,
      createdById: agencyUser.id,
      assigneeId: acmeWorker.id,
      clientId: acmeClient1.id
    },
  });

  await prisma.task.create({
    data: {
      title: "Monthly SEO report",
      description: "Generate and send monthly SEO performance report to client",
      category: "Link building",
      status: "DONE",
      agencyId: acmeAgency.id,
      createdById: agencyUser.id,
      assigneeId: acmeWorker1.id,
      clientId: acmeClient1.id
    },
  });

  await prisma.task.create({
    data: {
      title: "Fix title tags on category pages",
      description: "Fix title tages on category pages",
      category: "Link building",
      status: "TODO",
      agencyId: acmeAgency.id,
      createdById: agencyUser.id,
      assigneeId: acmeWorker1.id,
      clientId: acmeClient.id
    },
  });

  await prisma.task.create({
    data: {
      title: "SILO Structure Mapping",
      description: "Plan website SILO architecture based on keywords and categories.",
      category: "On-page",
      status: "IN_PROGRESS",
      agencyId: superAdminAgency.id,
      createdById: superAdminUser.id,
      assigneeId: superAdminWorker.id,
      clientId: superAdminClient.id
    },
  });

  await prisma.task.create({
    data: {
      title: "Competitor Analysis",
      description: "Analyze top competitors’ backlink profiles and content strategies.",
      category: "Link building",
      status: "TODO",
      agencyId: superAdminAgency.id,
      createdById: superAdminUser.id,
      assigneeId: superAdminWorker.id,
      clientId: superAdminClient.id
    },
  });

  console.log("✅ Created sample tasks");

  // Create sample SEO reports for clients
  const reportDates = [
    new Date('2024-01-01'),
    new Date('2024-02-01'),
    new Date('2024-03-01'),
    new Date('2024-04-01'),
    new Date('2024-05-01'),
    new Date('2024-06-01'),
  ];

  // SEO reports for superAdminClient
  for (let i = 0; i < reportDates.length; i++) {
    const date = reportDates[i];
    const baseSessions = 4000 + (i * 200);
    const baseClicks = 4500 + (i * 300);
    const baseImpressions = 15000 + (i * 1000);

    await prisma.seoReport.create({
      data: {
        reportDate: date,
        period: 'monthly',
        totalSessions: baseSessions,
        organicSessions: Math.floor(baseSessions * 0.7),
        paidSessions: Math.floor(baseSessions * 0.15),
        directSessions: Math.floor(baseSessions * 0.1),
        referralSessions: Math.floor(baseSessions * 0.05),
        totalClicks: baseClicks,
        totalImpressions: baseImpressions,
        averageCtr: 3.0 + (Math.random() * 0.5),
        averagePosition: 12.0 - (i * 0.2),
        bounceRate: 35 - (i * 1),
        avgSessionDuration: 180 + (i * 10),
        pagesPerSession: 2.5 + (i * 0.1),
        conversions: 150 + (i * 20),
        conversionRate: 3.5 + (i * 0.2),
        clientId: superAdminClient.id,
      },
    });
  }

  // SEO reports for acmeClient
  for (let i = 0; i < reportDates.length; i++) {
    const date = reportDates[i];
    const baseSessions = 3000 + (i * 150);
    const baseClicks = 3500 + (i * 200);
    const baseImpressions = 12000 + (i * 800);

    await prisma.seoReport.create({
      data: {
        reportDate: date,
        period: 'monthly',
        totalSessions: baseSessions,
        organicSessions: Math.floor(baseSessions * 0.65),
        paidSessions: Math.floor(baseSessions * 0.20),
        directSessions: Math.floor(baseSessions * 0.10),
        referralSessions: Math.floor(baseSessions * 0.05),
        totalClicks: baseClicks,
        totalImpressions: baseImpressions,
        averageCtr: 2.8 + (Math.random() * 0.4),
        averagePosition: 15.0 - (i * 0.3),
        bounceRate: 40 - (i * 1.5),
        avgSessionDuration: 160 + (i * 8),
        pagesPerSession: 2.2 + (i * 0.1),
        conversions: 120 + (i * 15),
        conversionRate: 3.2 + (i * 0.15),
        clientId: acmeClient.id,
      },
    });
  }

  // Create sample keywords for both clients
  const keywords = [
    { keyword: 'seo services', searchVolume: 12000, difficulty: 65, cpc: 2.50, competition: 'High' },
    { keyword: 'digital marketing', searchVolume: 8500, difficulty: 70, cpc: 3.20, competition: 'High' },
    { keyword: 'content marketing', searchVolume: 6200, difficulty: 55, cpc: 1.80, competition: 'Medium' },
    { keyword: 'link building', searchVolume: 4800, difficulty: 60, cpc: 2.10, competition: 'Medium' },
    { keyword: 'local seo', searchVolume: 7200, difficulty: 45, cpc: 1.50, competition: 'Low' },
    { keyword: 'seo audit', searchVolume: 3200, difficulty: 40, cpc: 1.20, competition: 'Low' },
    { keyword: 'keyword research', searchVolume: 2800, difficulty: 35, cpc: 0.90, competition: 'Low' },
    { keyword: 'technical seo', searchVolume: 1900, difficulty: 50, cpc: 1.40, competition: 'Medium' },
  ];

  for (const keywordData of keywords) {
    // Keywords for superAdminClient
    await prisma.keyword.create({
      data: {
        ...keywordData,
        currentPosition: Math.floor(Math.random() * 20) + 1,
        previousPosition: Math.floor(Math.random() * 20) + 1,
        bestPosition: Math.floor(Math.random() * 10) + 1,
        clicks: Math.floor(Math.random() * 500) + 50,
        impressions: Math.floor(Math.random() * 2000) + 200,
        ctr: Math.random() * 5 + 1,
        clientId: superAdminClient.id,
      },
    });

    // Keywords for acmeClient
    await prisma.keyword.create({
      data: {
        ...keywordData,
        currentPosition: Math.floor(Math.random() * 25) + 1,
        previousPosition: Math.floor(Math.random() * 25) + 1,
        bestPosition: Math.floor(Math.random() * 15) + 1,
        clicks: Math.floor(Math.random() * 300) + 30,
        impressions: Math.floor(Math.random() * 1500) + 150,
        ctr: Math.random() * 4 + 0.5,
        clientId: acmeClient.id,
      },
    });
  }

  // Create sample backlinks
  const backlinkSources = [
    'example.com',
    'techblog.com',
    'businessnews.com',
    'startupguide.com',
    'marketinginsights.com',
    'seotips.com',
    'digitaltrends.com',
    'webmasterworld.com',
  ];

  const anchorTexts = [
    'best seo services',
    'digital marketing tips',
    'seo company',
    'marketing strategies',
    'link building guide',
    'content marketing ideas',
    'local seo expert',
    'technical seo audit',
  ];

  // Backlinks for superAdminClient
  for (let i = 0; i < 15; i++) {
    const sourceIndex = i % backlinkSources.length;
    const anchorIndex = i % anchorTexts.length;
    
    await prisma.backlink.create({
      data: {
        sourceUrl: `https://${backlinkSources[sourceIndex]}/article-${i + 1}`,
        targetUrl: `https://${superAdminClient.domain}/page-${i + 1}`,
        anchorText: anchorTexts[anchorIndex],
        domainRating: Math.floor(Math.random() * 40) + 40,
        urlRating: Math.floor(Math.random() * 30) + 30,
        traffic: Math.floor(Math.random() * 10000) + 1000,
        isFollow: Math.random() > 0.2,
        isLost: Math.random() > 0.9,
        firstSeen: new Date(Date.now() - Math.random() * 365 * 24 * 60 * 60 * 1000),
        lastSeen: new Date(Date.now() - Math.random() * 30 * 24 * 60 * 60 * 1000),
        clientId: superAdminClient.id,
      },
    });
  }

  // Backlinks for acmeClient
  for (let i = 0; i < 10; i++) {
    const sourceIndex = i % backlinkSources.length;
    const anchorIndex = i % anchorTexts.length;
    
    await prisma.backlink.create({
      data: {
        sourceUrl: `https://${backlinkSources[sourceIndex]}/article-${i + 1}`,
        targetUrl: `https://${acmeClient.domain}/page-${i + 1}`,
        anchorText: anchorTexts[anchorIndex],
        domainRating: Math.floor(Math.random() * 35) + 30,
        urlRating: Math.floor(Math.random() * 25) + 20,
        traffic: Math.floor(Math.random() * 8000) + 500,
        isFollow: Math.random() > 0.3,
        isLost: Math.random() > 0.85,
        firstSeen: new Date(Date.now() - Math.random() * 300 * 24 * 60 * 60 * 1000),
        lastSeen: new Date(Date.now() - Math.random() * 20 * 24 * 60 * 60 * 1000),
        clientId: acmeClient.id,
      },
    });
  }

  console.log("✅ Created sample SEO data");

  console.log("🎉 Database seeding completed successfully!");
  console.log("\n📋 Seeded accounts:");
  console.log("👤 SuperAdmin: super@super.com / 123123");
  console.log("👤 Admin: admin@admin.com / 123123");
  console.log("🏢 Agency: acme@acme.com / 123123");
  console.log("👷 Worker: worker@worker.com / 123123");
  console.log("👷 Worker: worker1@worker1.com / 123123");
}

main()
  .catch((e) => {
    console.error("❌ Error during seeding:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
