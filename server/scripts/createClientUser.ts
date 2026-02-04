import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

function getArg(name: string): string | undefined {
  const argv = process.argv.slice(2);
  const idx = argv.findIndex((a) => a === `--${name}`);
  if (idx === -1) return undefined;
  return argv[idx + 1];
}

function usage() {
  console.log(`
Create a CLIENT user + linked Client record.

Usage:
  npm run user:create-client -- --email "client@example.com" --password "ClientPass123!" --clientName "Acme Co" --domain "acme.example"

Optional:
  --name "Client User"
  --industry "SaaS"
  --agencyId "<agencyId>"   (links the user to an agency as SPECIALIST; optional)
`);
}

async function main() {
  const email = (getArg("email") || "client@client.com").trim().toLowerCase();
  const password = getArg("password") || "123123";
  const name = getArg("name") || "Client";
  const clientName = getArg("clientName") || "Client Demo";
  const domain = (getArg("domain") || "clientdemo.example").trim().toLowerCase();
  const industry = getArg("industry") || "General";
  const agencyId = getArg("agencyId");

  if (!email || !domain || !clientName) {
    usage();
    throw new Error("Missing required args: --email, --clientName, --domain");
  }

  const existingUser = await prisma.user.findUnique({ where: { email } });
  if (existingUser) {
    throw new Error(`User already exists with email: ${email}`);
  }

  const existingDomain = await prisma.client.findUnique({ where: { domain } });
  if (existingDomain) {
    throw new Error(`Client already exists with domain: ${domain}`);
  }

  const existingClientName = await prisma.client.findUnique({ where: { name: clientName } });
  if (existingClientName) {
    throw new Error(`Client already exists with name: ${clientName}`);
  }

  if (agencyId) {
    const agency = await prisma.agency.findUnique({ where: { id: agencyId } });
    if (!agency) {
      throw new Error(`No agency found for agencyId: ${agencyId}`);
    }
  }

  const passwordHash = await bcrypt.hash(password, 12);

  const user = await prisma.user.create({
    data: {
      name,
      email,
      passwordHash,
      role: "USER",
      verified: true,
      invited: false,
    },
  });

  const client = await prisma.client.create({
    data: {
      name: clientName,
      domain,
      industry,
      targets: JSON.stringify(["United States"]),
      status: "ACTIVE",
      userId: user.id,
    },
  });

  // Link this user to this client via client_users (client portal access)
  await prisma.clientUser.create({
    data: {
      clientId: client.id,
      userId: user.id,
      clientRole: "CLIENT",
      status: "ACTIVE",
      acceptedAt: new Date(),
    },
  });

  if (agencyId) {
    await prisma.userAgency.create({
      data: {
        userId: user.id,
        agencyId,
        agencyRole: "SPECIALIST",
      },
    });
  }

  console.log("✅ Created CLIENT user + linked Client");
  console.log("User:", { id: user.id, email: user.email, role: user.role });
  console.log("Client:", { id: client.id, name: client.name, domain: client.domain, userId: client.userId });
  console.log("Login password:", password);
}

main()
  .catch((err) => {
    console.error("❌ Failed to create client user:", err?.message || err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

