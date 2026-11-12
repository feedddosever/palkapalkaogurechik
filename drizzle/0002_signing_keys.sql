CREATE TABLE "signing_keys" (
	"kid" text PRIMARY KEY NOT NULL,
	"public_key_spki" text NOT NULL,
	"private_key_pkcs8" text,
	"source" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
