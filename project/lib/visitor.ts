import type { Context } from "@netlify/functions";
import { sql } from "drizzle-orm";
import { db } from "../db/index.js";
import { sessions, statsDaily } from "../db/schema.js";

const VISITOR_COOKIE = "tb_vid";
const VISITOR_ID_PATTERN = /^[0-9a-f-]{36}$/;

/**
 * Returns the anonymous visitor ID for this request, creating one (and a cookie) for first-time visitors.
 * Also records/refreshes the visitor's session row.
 */
export async function trackVisitor(req: Request, context: Context): Promise<string> {
  let visitorId = context.cookies.get(VISITOR_COOKIE);
  let isNew = false;

  if (!visitorId || !VISITOR_ID_PATTERN.test(visitorId)) {
    visitorId = crypto.randomUUID();
    isNew = true;
    context.cookies.set({
      name: VISITOR_COOKIE,
      value: visitorId,
      path: "/",
      httpOnly: true,
      secure: true,
      sameSite: "Lax",
      expires: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
    });
  }

  try {
    await db
      .insert(sessions)
      .values({
        id: visitorId,
        ip: context.ip || "unknown",
        userAgent: req.headers.get("user-agent") || "unknown",
        country: context.geo?.country?.code || null,
      })
      .onConflictDoUpdate({ target: sessions.id, set: { lastSeen: sql`now()` } });

    if (isNew) {
      await db
        .insert(statsDaily)
        .values({ date: sql`current_date`, uniqueVisitors: 1 })
        .onConflictDoUpdate({ target: statsDaily.date, set: { uniqueVisitors: sql`${statsDaily.uniqueVisitors} + 1` } });
    }
  } catch (err) {
    // Stats tracking must never break a request
    console.error("Visitor tracking error:", (err as Error).message);
  }

  return visitorId;
}
