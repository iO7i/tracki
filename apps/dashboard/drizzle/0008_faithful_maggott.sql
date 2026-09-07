CREATE TABLE "faq_proposals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"question" text NOT NULL,
	"question_key" text NOT NULL,
	"source" text DEFAULT 'search' NOT NULL,
	"occurrences" integer DEFAULT 1 NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"draft" jsonb NOT NULL,
	"article_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "faq_proposals" ADD CONSTRAINT "faq_proposals_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "faq_proposals" ADD CONSTRAINT "faq_proposals_article_id_faq_articles_id_fk" FOREIGN KEY ("article_id") REFERENCES "public"."faq_articles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "faq_proposals_project_qkey_idx" ON "faq_proposals" USING btree ("project_id","question_key");--> statement-breakpoint
CREATE INDEX "faq_proposals_project_status_idx" ON "faq_proposals" USING btree ("project_id","status");