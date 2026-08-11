ALTER TABLE "orders" ALTER COLUMN "cliente_codigo" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "clerk_user_id" text;--> statement-breakpoint
CREATE INDEX "orders_clerk_fecha" ON "orders" USING btree ("clerk_user_id","created_at");