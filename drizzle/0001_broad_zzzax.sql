CREATE TABLE "breakfast_feedback" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_id" uuid NOT NULL,
	"recorded_by_user_id" uuid,
	"category" text DEFAULT 'event' NOT NULL,
	"summary" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "breakfast_referrals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_id" uuid NOT NULL,
	"referred_by_folk_person_link_id" uuid,
	"referred_name" text NOT NULL,
	"referred_company" text,
	"referred_role" text,
	"referred_email" text,
	"status" text DEFAULT 'new' NOT NULL,
	"notes" text,
	"created_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "locale_carry_forward_queue" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"locale" text NOT NULL,
	"folk_person_link_id" uuid NOT NULL,
	"source_event_id" uuid NOT NULL,
	"reason" text DEFAULT 'responded_could_not_attend' NOT NULL,
	"consumed_by_event_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "breakfast_events" ADD COLUMN "venue_address" text;--> statement-breakpoint
ALTER TABLE "breakfast_events" ADD COLUMN "deposit_invoice_ref" text;--> statement-breakpoint
ALTER TABLE "breakfast_events" ADD COLUMN "balance_invoice_ref" text;--> statement-breakpoint
ALTER TABLE "breakfast_events" ADD COLUMN "preread_notes" text;--> statement-breakpoint
ALTER TABLE "breakfast_feedback" ADD CONSTRAINT "breakfast_feedback_event_id_breakfast_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."breakfast_events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "breakfast_feedback" ADD CONSTRAINT "breakfast_feedback_recorded_by_user_id_users_id_fk" FOREIGN KEY ("recorded_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "breakfast_referrals" ADD CONSTRAINT "breakfast_referrals_event_id_breakfast_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."breakfast_events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "breakfast_referrals" ADD CONSTRAINT "breakfast_referrals_referred_by_folk_person_link_id_folk_people_link_id_fk" FOREIGN KEY ("referred_by_folk_person_link_id") REFERENCES "public"."folk_people_link"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "breakfast_referrals" ADD CONSTRAINT "breakfast_referrals_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "locale_carry_forward_queue" ADD CONSTRAINT "locale_carry_forward_queue_folk_person_link_id_folk_people_link_id_fk" FOREIGN KEY ("folk_person_link_id") REFERENCES "public"."folk_people_link"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "locale_carry_forward_queue" ADD CONSTRAINT "locale_carry_forward_queue_source_event_id_breakfast_events_id_fk" FOREIGN KEY ("source_event_id") REFERENCES "public"."breakfast_events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "locale_carry_forward_queue" ADD CONSTRAINT "locale_carry_forward_queue_consumed_by_event_id_breakfast_events_id_fk" FOREIGN KEY ("consumed_by_event_id") REFERENCES "public"."breakfast_events"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "locale_carry_forward_queue_uidx" ON "locale_carry_forward_queue" USING btree ("locale","folk_person_link_id","source_event_id");