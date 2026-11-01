CREATE TABLE "admin_sessions" (
	"token" text PRIMARY KEY,
	"admin_id" integer NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "admin_users" (
	"id" serial PRIMARY KEY,
	"username" text NOT NULL UNIQUE,
	"password_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_login" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "operations" (
	"id" serial PRIMARY KEY,
	"session_id" text,
	"tool" text NOT NULL,
	"original_size" bigint,
	"result_size" bigint,
	"savings_percent" real,
	"filename" text,
	"status" text DEFAULT 'success' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "page_views" (
	"id" serial PRIMARY KEY,
	"session_id" text,
	"page" text,
	"referrer" text,
	"viewed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" text PRIMARY KEY,
	"ip" text,
	"user_agent" text,
	"country" text,
	"first_seen" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "stats_daily" (
	"id" serial PRIMARY KEY,
	"date" date NOT NULL UNIQUE,
	"unique_visitors" integer DEFAULT 0 NOT NULL,
	"total_operations" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE INDEX "operations_created_at_idx" ON "operations" ("created_at");--> statement-breakpoint
CREATE INDEX "operations_tool_idx" ON "operations" ("tool");--> statement-breakpoint
CREATE INDEX "sessions_last_seen_idx" ON "sessions" ("last_seen");--> statement-breakpoint
ALTER TABLE "admin_sessions" ADD CONSTRAINT "admin_sessions_admin_id_admin_users_id_fkey" FOREIGN KEY ("admin_id") REFERENCES "admin_users"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "operations" ADD CONSTRAINT "operations_session_id_sessions_id_fkey" FOREIGN KEY ("session_id") REFERENCES "sessions"("id") ON DELETE SET NULL;