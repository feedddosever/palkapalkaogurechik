CREATE TABLE "workspaces" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"kind" text DEFAULT 'demo' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
