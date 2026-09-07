ALTER TABLE "projects" ADD COLUMN "currency" text DEFAULT 'SAR' NOT NULL;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "avg_order_value" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "conversion_event" text DEFAULT 'purchase' NOT NULL;