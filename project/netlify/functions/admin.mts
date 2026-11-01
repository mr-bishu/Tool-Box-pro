import type { Config, Context } from "@netlify/functions";
import bcrypt from "bcryptjs";
import { count, desc, eq, sql } from "drizzle-orm";
import { db } from "../../db/index.js";
import { adminUsers, operations, sessions, statsDaily } from "../../db/schema.js";
import { endAdminSession, getAdmin, startAdminSession } from "../../lib/auth.js";

type Admin = NonNullable<Awaited<ReturnType<typeof getAdmin>>>;

const maskIp = (ip: string | null) => (ip ? ip.replace(/\.\d+$/, ".***") : "N/A");

const pageParams = (url: URL) => {
  const page = Math.max(1, parseInt(url.searchParams.get("page") || "") || 1);
  const limit = Math.min(100, Math.max(1, parseInt(url.searchParams.get("limit") || "") || 25));
  return { page, limit, offset: (page - 1) * limit };
};

const operationsWithSession = () =>
  db
    .select({
      id: operations.id,
      tool: operations.tool,
      filename: operations.filename,
      originalSize: operations.originalSize,
      resultSize: operations.resultSize,
      savings: operations.savingsPercent,
      status: operations.status,
      createdAt: operations.createdAt,
      ip: sessions.ip,
      userAgent: sessions.userAgent,
    })
    .from(operations)
    .leftJoin(sessions, eq(operations.sessionId, sessions.id))
    .$dynamic();

const operationsByTool = () =>
  db
    .select({
      tool: operations.tool,
      count: count(),
      total_original: sql<number>`coalesce(sum(${operations.originalSize}), 0)::bigint`.mapWith(Number),
      total_result: sql<number>`coalesce(sum(${operations.resultSize}), 0)::bigint`.mapWith(Number),
    })
    .from(operations)
    .groupBy(operations.tool)
    .orderBy(desc(count()));

const dailyStats = () => db.select().from(statsDaily).orderBy(desc(statsDaily.date)).limit(30);

const activeSince = sql`now() - interval '30 minutes'`;

const userCounts = () =>
  db.select({
    totalUsers: count(),
    activeUsers: sql<number>`count(*) filter (where ${sessions.lastSeen} > ${activeSince})`.mapWith(Number),
  }).from(sessions);

// Creates the default admin account the first time anyone tries to sign in
async function ensureDefaultAdmin() {
  const [{ total }] = await db.select({ total: count() }).from(adminUsers);
  if (total > 0) return;
  const password = Netlify.env.get("ADMIN_PASSWORD") || "admin123";
  await db
    .insert(adminUsers)
    .values({ username: "admin", passwordHash: await bcrypt.hash(password, 10) })
    .onConflictDoNothing();
}

// ─── Route handlers ───────────────────────────────────────────────────────────
async function login(req: Request, context: Context) {
  const { username, password } = await req.json().catch(() => ({}));
  if (typeof username !== "string" || typeof password !== "string" || !username.trim() || !password ||
      username.length > 50 || password.length > 100) {
    return Response.json({ error: "Invalid input" }, { status: 400 });
  }

  await ensureDefaultAdmin();
  const [admin] = await db.select().from(adminUsers).where(eq(adminUsers.username, username.trim())).limit(1);

  // Compare against a dummy hash when the user doesn't exist to keep timing consistent
  const isValid = await bcrypt.compare(password, admin?.passwordHash || "$2a$10$invalidhashpadding000000000000000000000000000000000000");
  if (!admin || !isValid) return Response.json({ error: "Invalid credentials" }, { status: 401 });

  await startAdminSession(context, admin.id);
  await db.update(adminUsers).set({ lastLogin: new Date() }).where(eq(adminUsers.id, admin.id));
  return Response.json({ success: true, username: admin.username });
}

async function dashboard() {
  const [[users], [ops], tools, recent, daily] = await Promise.all([
    userCounts(),
    db.select({
      totalOperations: sql<number>`count(*) filter (where ${operations.status} = 'success')`.mapWith(Number),
      totalBytesSaved: sql<number>`coalesce(sum(${operations.originalSize} - ${operations.resultSize}) filter (where ${operations.resultSize} > 0), 0)`.mapWith(Number),
    }).from(operations),
    operationsByTool(),
    operationsWithSession().orderBy(desc(operations.createdAt)).limit(20),
    dailyStats(),
  ]);

  return Response.json({
    success: true,
    summary: { ...users, ...ops },
    operationsByTool: tools,
    recentOperations: recent.map((op) => ({ ...op, ip: maskIp(op.ip) })),
    dailyStats: daily,
  });
}

async function listSessions(url: URL) {
  const { page, limit, offset } = pageParams(url);
  const [rows, [{ total }]] = await Promise.all([
    db
      .select({
        id: sessions.id,
        ip: sessions.ip,
        user_agent: sessions.userAgent,
        first_seen: sessions.firstSeen,
        last_seen: sessions.lastSeen,
        operation_count: count(operations.id),
      })
      .from(sessions)
      .leftJoin(operations, eq(operations.sessionId, sessions.id))
      .groupBy(sessions.id)
      .orderBy(desc(sessions.lastSeen))
      .limit(limit)
      .offset(offset),
    db.select({ total: count() }).from(sessions),
  ]);

  return Response.json({
    success: true,
    sessions: rows.map((s) => ({ ...s, ip: maskIp(s.ip) })),
    pagination: { page, limit, total, pages: Math.ceil(total / limit) },
  });
}

async function listOperations(url: URL) {
  const { page, limit, offset } = pageParams(url);
  const tool = url.searchParams.get("tool");
  const filter = tool ? eq(operations.tool, tool) : undefined;

  const [rows, [{ total }]] = await Promise.all([
    operationsWithSession().where(filter).orderBy(desc(operations.createdAt)).limit(limit).offset(offset),
    db.select({ total: count() }).from(operations).where(filter),
  ]);

  return Response.json({
    success: true,
    operations: rows.map((op) => ({ ...op, ip: maskIp(op.ip) })),
    pagination: { page, limit, total, pages: Math.ceil(total / limit) },
  });
}

async function stats() {
  const [daily, tools, [users], [ops]] = await Promise.all([
    dailyStats(),
    operationsByTool(),
    userCounts(),
    db.select({
      successOps: sql<number>`count(*) filter (where ${operations.status} = 'success')`.mapWith(Number),
      errorOps: sql<number>`count(*) filter (where ${operations.status} = 'error')`.mapWith(Number),
    }).from(operations),
  ]);

  return Response.json({ success: true, daily, tools, ...users, ...ops });
}

async function changePassword(req: Request, admin: Admin) {
  const { currentPassword, newPassword } = await req.json().catch(() => ({}));
  if (typeof currentPassword !== "string" || !currentPassword) {
    return Response.json({ error: "Current password is required" }, { status: 400 });
  }
  if (typeof newPassword !== "string" || newPassword.length < 8 || newPassword.length > 100) {
    return Response.json({ error: "Password must be 8-100 characters" }, { status: 400 });
  }

  if (!(await bcrypt.compare(currentPassword, admin.passwordHash))) {
    return Response.json({ error: "Current password is incorrect" }, { status: 401 });
  }

  await db.update(adminUsers).set({ passwordHash: await bcrypt.hash(newPassword, 12) }).where(eq(adminUsers.id, admin.id));
  return Response.json({ success: true, message: "Password updated successfully" });
}

export default async (req: Request, context: Context) => {
  const url = new URL(req.url);
  const route = `${req.method} ${context.params.action}`;

  try {
    if (route === "POST login") return await login(req, context);

    const admin = await getAdmin(context);
    if (route === "GET check-auth") {
      return Response.json({ authenticated: !!admin, username: admin?.username || null });
    }
    if (!admin) return Response.json({ error: "Unauthorized. Please login." }, { status: 401 });

    switch (route) {
      case "POST logout":
        await endAdminSession(context);
        return Response.json({ success: true });
      case "GET dashboard": return await dashboard();
      case "GET sessions": return await listSessions(url);
      case "GET operations": return await listOperations(url);
      case "GET stats": return await stats();
      case "POST change-password": return await changePassword(req, admin);
      default: return Response.json({ error: "Not found" }, { status: 404 });
    }
  } catch (err) {
    console.error(`Admin ${route} error:`, err);
    return Response.json({ error: "Request failed" }, { status: 500 });
  }
};

export const config: Config = {
  path: "/api/admin/:action",
  rateLimit: { windowLimit: 100, windowSize: 60, aggregateBy: ["ip", "domain"] },
};
