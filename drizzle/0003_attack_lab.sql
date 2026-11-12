CREATE TABLE "lab_plants" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"product_id" text NOT NULL,
	"text" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "lab_runs" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"run_id" text NOT NULL,
	"scenario" text NOT NULL,
	"driver" text NOT NULL,
	"attack" jsonb,
	"client_key" text NOT NULL,
	"ai_layers" boolean DEFAULT false NOT NULL,
	"status" text DEFAULT 'running' NOT NULL,
	"outcome" jsonb,
	"blocked" integer DEFAULT 0 NOT NULL,
	"cost_usd" numeric(10, 6) DEFAULT '0' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "lab_plants" ADD CONSTRAINT "lab_plants_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "lab_plants_ws_idx" ON "lab_plants" USING btree ("workspace_id","product_id");--> statement-breakpoint
CREATE INDEX "lab_runs_created_idx" ON "lab_runs" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "lab_runs_client_idx" ON "lab_runs" USING btree ("client_key","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "lab_runs_run_idx" ON "lab_runs" USING btree ("run_id");