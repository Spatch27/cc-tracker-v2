CREATE TABLE "account_intelligence" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"gold_account_id" uuid NOT NULL,
	"dimension" text NOT NULL,
	"summary" text NOT NULL,
	"fact_type" text DEFAULT 'verified' NOT NULL,
	"evidence_date" timestamp with time zone,
	"observed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"source_url" text,
	"source_note" text,
	"recorded_by_user_id" uuid,
	"recorded_by_agent_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "buying_signals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"gold_account_id" uuid NOT NULL,
	"signal_type" text NOT NULL,
	"title" text NOT NULL,
	"details" text,
	"fact_type" text DEFAULT 'verified' NOT NULL,
	"signal_date" timestamp with time zone,
	"observed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"source_url" text,
	"source_note" text,
	"recorded_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "gold_account_contacts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"gold_account_id" uuid NOT NULL,
	"folk_person_link_id" uuid,
	"role_category" text NOT NULL,
	"is_primary_decision_maker" boolean DEFAULT false NOT NULL,
	"coverage_status" text DEFAULT 'mapped' NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "gold_accounts" ADD COLUMN "fit_notes" text;--> statement-breakpoint
ALTER TABLE "gold_accounts" ADD COLUMN "last_interactions_sync_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "gold_accounts" ADD COLUMN "last_interactions_sync_note" text;--> statement-breakpoint
ALTER TABLE "account_intelligence" ADD CONSTRAINT "account_intelligence_gold_account_id_gold_accounts_id_fk" FOREIGN KEY ("gold_account_id") REFERENCES "public"."gold_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "account_intelligence" ADD CONSTRAINT "account_intelligence_recorded_by_user_id_users_id_fk" FOREIGN KEY ("recorded_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "account_intelligence" ADD CONSTRAINT "account_intelligence_recorded_by_agent_id_agent_identities_id_fk" FOREIGN KEY ("recorded_by_agent_id") REFERENCES "public"."agent_identities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "buying_signals" ADD CONSTRAINT "buying_signals_gold_account_id_gold_accounts_id_fk" FOREIGN KEY ("gold_account_id") REFERENCES "public"."gold_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "buying_signals" ADD CONSTRAINT "buying_signals_recorded_by_user_id_users_id_fk" FOREIGN KEY ("recorded_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gold_account_contacts" ADD CONSTRAINT "gold_account_contacts_gold_account_id_gold_accounts_id_fk" FOREIGN KEY ("gold_account_id") REFERENCES "public"."gold_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gold_account_contacts" ADD CONSTRAINT "gold_account_contacts_folk_person_link_id_folk_people_link_id_fk" FOREIGN KEY ("folk_person_link_id") REFERENCES "public"."folk_people_link"("id") ON DELETE no action ON UPDATE no action;