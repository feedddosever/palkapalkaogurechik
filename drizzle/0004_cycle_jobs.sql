CREATE TABLE "reconciliations" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"mode" text NOT NULL,
	"range_start" timestamp with time zone NOT NULL,
	"range_end" timestamp with time zone NOT NULL,
	"checked" integer NOT NULL,
	"matched" integer NOT NULL,
	"pending" integer NOT NULL,
	"issues" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "cycles" ADD COLUMN "reauthorized_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "cycles" ADD COLUMN "previous_cycle_id" text;--> statement-breakpoint
ALTER TABLE "reconciliations" ADD CONSTRAINT "reconciliations_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "recon_ws_idx" ON "reconciliations" USING btree ("workspace_id","created_at");