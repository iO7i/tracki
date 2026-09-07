CREATE TABLE "faq_articles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"slug" text NOT NULL,
	"category" text DEFAULT '' NOT NULL,
	"tags" text[] DEFAULT '{}' NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"title_ar" text DEFAULT '' NOT NULL,
	"body_ar" text DEFAULT '' NOT NULL,
	"title_en" text DEFAULT '' NOT NULL,
	"body_en" text DEFAULT '' NOT NULL,
	"search_text" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "faq_articles" ADD CONSTRAINT "faq_articles_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "faq_project_slug_idx" ON "faq_articles" USING btree ("project_id","slug");--> statement-breakpoint
CREATE INDEX "faq_project_status_idx" ON "faq_articles" USING btree ("project_id","status");