import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

const ROLE_ENUM_VALUES = ["SUPER_ADMIN", "ADMIN", "AGENCY", "WORKER", "CLIENT"] as const;

function getArg(name: string): string | undefined {
  const argv = process.argv.slice(2);
  const idx = argv.findIndex((a) => a === `--${name}`);
  if (idx === -1) return undefined;
  return argv[idx + 1];
}

async function ensureClientRoleEnum() {
  // If your DB was created before the CLIENT enum value existed, MySQL will reject inserts with "Data truncated".
  // This makes a minimal, targeted update to the enum columns.
  type ColRow = { TABLE_NAME: string; COLUMN_NAME: string; COLUMN_TYPE: string };

  const cols = (await prisma.$queryRaw<ColRow[]>`
    SELECT TABLE_NAME, COLUMN_NAME, COLUMN_TYPE
    FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND (
        (TABLE_NAME = 'users' AND COLUMN_NAME = 'role')
        OR (TABLE_NAME = 'tokens' AND COLUMN_NAME = 'role')
      )
  `) as ColRow[];

  const desiredEnum = `ENUM(${ROLE_ENUM_VALUES.map((v) => `'${v}'`).join(",")})`;

  for (const col of cols) {
    const hasClient = String(col.COLUMN_TYPE || "").toUpperCase().includes("'CLIENT'");
    const isEnum = String(col.COLUMN_TYPE || "").toLowerCase().startsWith("enum(");
    if (!isEnum) continue;
    if (hasClient) continue;

    const table = col.TABLE_NAME;
    const column = col.COLUMN_NAME;

    // users.role is NOT NULL, tokens.role is nullable in schema
    const nullable = table === "tokens";
    const nullSql = nullable ? "NULL" : "NOT NULL";
    const defaultSql = table === "users" ? "DEFAULT 'AGENCY'" : "";

    const sql = `ALTER TABLE \`${table}\` MODIFY COLUMN \`${column}\` ${desiredEnum} ${nullSql} ${defaultSql}`.trim();
    await prisma.$executeRawUnsafe(sql);
    console.log(`✅ Updated ${table}.${column} enum to include CLIENT`);
  }
}

function usage() {
  console.log(`
Create a CLIENT user + linked Client record.

Usage:
  npm run user:create-client -- --email "client@example.com" --password "ClientPass123!" --clientName "Acme Co" --domain "acme.example"

Optional:
  --name "Client User"
  --industry "SaaS"
  --agencyId "<agencyId>"   (links the user to an agency as WORKER; optional)
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

  await ensureClientRoleEnum();

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
      role: "CLIENT",
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

  if (agencyId) {
    await prisma.userAgency.create({
      data: {
        userId: user.id,
        agencyId,
        agencyRole: "WORKER",
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

