ALTER TABLE "wa_messages" ADD COLUMN "provider_message_id" text;
--> statement-breakpoint
ALTER TABLE "wa_messages" ADD COLUMN "effect_id" text;
--> statement-breakpoint
CREATE UNIQUE INDEX "wa_messages_provider_message_id_uidx" ON "wa_messages" USING btree ("provider_message_id") WHERE "provider_message_id" IS NOT NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX "wa_messages_effect_id_uidx" ON "wa_messages" USING btree ("effect_id") WHERE "effect_id" IS NOT NULL;
