ALTER TABLE "wallets" ALTER COLUMN "address" SET DATA TYPE varchar(100);--> statement-breakpoint
ALTER TABLE "wallets" ADD COLUMN "encrypted_private_key" text;--> statement-breakpoint
ALTER TABLE "wallets" DROP COLUMN IF EXISTS "balance";--> statement-breakpoint
ALTER TABLE "wallets" DROP COLUMN IF EXISTS "last_sync";