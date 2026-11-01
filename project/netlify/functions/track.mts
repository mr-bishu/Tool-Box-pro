import type { Config, Context } from "@netlify/functions";
import { db } from "../../db/index.js";
import { pageViews } from "../../db/schema.js";
import { trackVisitor } from "../../lib/visitor.js";

// Records a page view; called by the frontend on page load
export default async (req: Request, context: Context) => {
  const sessionId = await trackVisitor(req, context);
  try {
    const { page, referrer } = await req.json().catch(() => ({}));
    await db.insert(pageViews).values({
      sessionId,
      page: String(page || "/").slice(0, 300),
      referrer: String(referrer || "").slice(0, 500),
    });
  } catch (err) {
    console.error("Page view tracking error:", (err as Error).message);
  }
  return new Response(null, { status: 204 });
};

export const config: Config = {
  path: "/api/track",
  method: "POST",
  rateLimit: { windowLimit: 60, windowSize: 60, aggregateBy: ["ip", "domain"] },
};
