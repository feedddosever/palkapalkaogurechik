CREATE TABLE "ai_spend" (
	"day" text PRIMARY KEY NOT NULL,
	"usd" numeric(12, 6) DEFAULT '0' NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
