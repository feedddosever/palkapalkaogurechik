CREATE TABLE "bench_reports" (
	"id" text PRIMARY KEY NOT NULL,
	"status" text NOT NULL,
	"report" jsonb,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone
);
