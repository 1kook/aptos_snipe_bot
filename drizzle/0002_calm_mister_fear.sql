CREATE TABLE IF NOT EXISTS "coins" (
	"id" serial PRIMARY KEY NOT NULL,
	"address" varchar(255),
	"name" varchar(255),
	"symbol" varchar(255),
	"decimals" integer,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
