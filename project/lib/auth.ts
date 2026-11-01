import type { Context } from "@netlify/functions";
import { and, eq, gt } from "drizzle-orm";
import { db } from "../db/index.js";
import { adminSessions, adminUsers } from "../db/schema.js";

export const ADMIN_COOKIE = "tb_admin";
export const ADMIN_SESSION_MS = 24 * 60 * 60 * 1000;

export async function getAdmin(context: Context) {
  const token = context.cookies.get(ADMIN_COOKIE);
  if (!token) return null;

  const [row] = await db
    .select({ id: adminUsers.id, username: adminUsers.username, passwordHash: adminUsers.passwordHash })
    .from(adminSessions)
    .innerJoin(adminUsers, eq(adminSessions.adminId, adminUsers.id))
    .where(and(eq(adminSessions.token, token), gt(adminSessions.expiresAt, new Date())))
    .limit(1);

  return row || null;
}

export async function startAdminSession(context: Context, adminId: number) {
  const token = crypto.randomUUID() + crypto.randomUUID();
  const expiresAt = new Date(Date.now() + ADMIN_SESSION_MS);
  await db.insert(adminSessions).values({ token, adminId, expiresAt });
  context.cookies.set({ name: ADMIN_COOKIE, value: token, path: "/", httpOnly: true, secure: true, sameSite: "Strict", expires: expiresAt });
}

export async function endAdminSession(context: Context) {
  const token = context.cookies.get(ADMIN_COOKIE);
  if (token) await db.delete(adminSessions).where(eq(adminSessions.token, token));
  context.cookies.delete({ name: ADMIN_COOKIE, path: "/" });
}
