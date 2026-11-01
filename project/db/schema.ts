import { pgTable, serial, text, timestamp, integer, bigint, real, date, index } from "drizzle-orm/pg-core";

export const sessions = pgTable("sessions", {
  id: text().primaryKey(),
  ip: text(),
  userAgent: text("user_agent"),
  country: text(),
  firstSeen: timestamp("first_seen", { withTimezone: true }).defaultNow().notNull(),
  lastSeen: timestamp("last_seen", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [index("sessions_last_seen_idx").on(t.lastSeen)]);

export const operations = pgTable("operations", {
  id: serial().primaryKey(),
  sessionId: text("session_id").references(() => sessions.id, { onDelete: "set null" }),
  tool: text().notNull(),
  originalSize: bigint("original_size", { mode: "number" }),
  resultSize: bigint("result_size", { mode: "number" }),
  savingsPercent: real("savings_percent"),
  filename: text(),
  status: text().notNull().default("success"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [index("operations_created_at_idx").on(t.createdAt), index("operations_tool_idx").on(t.tool)]);

export const adminUsers = pgTable("admin_users", {
  id: serial().primaryKey(),
  username: text().notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  lastLogin: timestamp("last_login", { withTimezone: true }),
});

export const adminSessions = pgTable("admin_sessions", {
  token: text().primaryKey(),
  adminId: integer("admin_id").notNull().references(() => adminUsers.id, { onDelete: "cascade" }),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
});

export const statsDaily = pgTable("stats_daily", {
  id: serial().primaryKey(),
  date: date().notNull().unique(),
  uniqueVisitors: integer("unique_visitors").notNull().default(0),
  totalOperations: integer("total_operations").notNull().default(0),
});

export const pageViews = pgTable("page_views", {
  id: serial().primaryKey(),
  sessionId: text("session_id"),
  page: text(),
  referrer: text(),
  viewedAt: timestamp("viewed_at", { withTimezone: true }).defaultNow().notNull(),
});
