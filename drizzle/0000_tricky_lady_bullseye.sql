CREATE TABLE "agent_identities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"token_hash" text NOT NULL,
	"token_prefix" text NOT NULL,
	"scopes" jsonb NOT NULL,
	"created_by_user_id" uuid,
	"revoked_at" timestamp with time zone,
	"last_used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "agent_identities_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "audit_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"actor_type" text NOT NULL,
	"actor_user_id" uuid,
	"actor_agent_id" uuid,
	"initiating_user_id" uuid,
	"action" text NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" text,
	"field_name" text,
	"previous_value_json" jsonb,
	"new_value_json" jsonb,
	"source" text,
	"evidence_date" timestamp with time zone,
	"outcome" text NOT NULL,
	"metadata_json" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "breakfast_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"locale" text NOT NULL,
	"title" text NOT NULL,
	"event_date" timestamp with time zone NOT NULL,
	"venue_name" text,
	"total_capacity" integer DEFAULT 14 NOT NULL,
	"status" text DEFAULT 'planning' NOT NULL,
	"booking_status" text DEFAULT 'unconfirmed',
	"booking_reference" text,
	"venue_contact" text,
	"booking_docs_url" text,
	"deposit_amount_pence" integer,
	"deposit_due_date" timestamp with time zone,
	"deposit_paid" boolean DEFAULT false NOT NULL,
	"balance_amount_pence" integer,
	"balance_due_date" timestamp with time zone,
	"balance_paid" boolean DEFAULT false NOT NULL,
	"logistics_owner_user_id" uuid,
	"preread_url" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "breakfast_hosts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"attending" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "breakfast_invitation_history" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"invitation_id" uuid NOT NULL,
	"changed_by_user_id" uuid,
	"previous_response_status" text,
	"new_response_status" text,
	"previous_attendance_outcome" text,
	"new_attendance_outcome" text,
	"previous_waitlist_status" text,
	"new_waitlist_status" text,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "breakfast_invitations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_id" uuid NOT NULL,
	"folk_person_link_id" uuid NOT NULL,
	"response_status" text DEFAULT 'provisional' NOT NULL,
	"attendance_outcome" text DEFAULT 'pending' NOT NULL,
	"waitlist_status" text DEFAULT 'none' NOT NULL,
	"chase_status" text DEFAULT 'none' NOT NULL,
	"carried_forward_from_event_id" uuid,
	"dietary_notes" text,
	"special_requests" text,
	"early_departure_note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "change_proposals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"target_system" text NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" text NOT NULL,
	"folk_record_id" text,
	"proposed_by_agent_id" uuid,
	"proposed_by_user_id" uuid,
	"summary" text NOT NULL,
	"proposed_changes_json" jsonb NOT NULL,
	"base_snapshot_json" jsonb NOT NULL,
	"payload_hash" text NOT NULL,
	"source_url" text,
	"source_note" text,
	"fact_type" text DEFAULT 'verified' NOT NULL,
	"evidence_date" timestamp with time zone,
	"observed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"status" text DEFAULT 'pending_review' NOT NULL,
	"reviewed_by_user_id" uuid,
	"reviewed_at" timestamp with time zone,
	"review_note" text,
	"applied_at" timestamp with time zone,
	"apply_error" text,
	"idempotency_key" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "change_proposals_idempotency_key_unique" UNIQUE("idempotency_key")
);
--> statement-breakpoint
CREATE TABLE "folk_companies_link" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"folk_company_id" text NOT NULL,
	"name" text NOT NULL,
	"domain" text,
	"last_synced_at" timestamp with time zone,
	"sync_status" text DEFAULT 'linked' NOT NULL,
	"sync_error" text,
	"snapshot_json" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "folk_companies_link_folk_company_id_unique" UNIQUE("folk_company_id")
);
--> statement-breakpoint
CREATE TABLE "folk_people_link" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"folk_person_id" text NOT NULL,
	"folk_company_link_id" uuid,
	"full_name" text NOT NULL,
	"email" text,
	"job_title" text,
	"linkedin_url" text,
	"folk_owner_id" text,
	"contact_suppressed" boolean DEFAULT false NOT NULL,
	"suppression_reason" text,
	"suppressed_at" timestamp with time zone,
	"last_synced_at" timestamp with time zone,
	"sync_status" text DEFAULT 'linked' NOT NULL,
	"sync_error" text,
	"snapshot_json" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "folk_people_link_folk_person_id_unique" UNIQUE("folk_person_id")
);
--> statement-breakpoint
CREATE TABLE "follow_up_actions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"gold_account_id" uuid,
	"breakfast_event_id" uuid,
	"folk_person_link_id" uuid,
	"activity_id" uuid,
	"owner_user_id" uuid NOT NULL,
	"title" text NOT NULL,
	"notes" text,
	"due_date" timestamp with time zone NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"flagged_by_reply_activity_id" uuid,
	"snooze_history_json" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "gold_accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"folk_company_link_id" uuid NOT NULL,
	"owner_user_id" uuid NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"marketing_team_size" integer,
	"legacy_setup_notes" text,
	"legacy_score_metadata_json" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "gold_accounts_folk_company_link_id_unique" UNIQUE("folk_company_link_id")
);
--> statement-breakpoint
CREATE TABLE "message_approvals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"gold_account_id" uuid,
	"breakfast_event_id" uuid,
	"folk_person_link_id" uuid,
	"sender_user_id" uuid NOT NULL,
	"recipient_name" text NOT NULL,
	"recipient_address" text NOT NULL,
	"channel" text NOT NULL,
	"subject" text,
	"body" text NOT NULL,
	"content_hash" text NOT NULL,
	"proposed_by_agent_id" uuid,
	"proposed_by_user_id" uuid,
	"status" text DEFAULT 'awaiting_approval' NOT NULL,
	"approved_by_user_id" uuid,
	"approved_at" timestamp with time zone,
	"approval_token_hash" text,
	"execution_idempotency_key" text,
	"executed_at" timestamp with time zone,
	"execution_note" text,
	"linked_activity_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "message_approvals_execution_idempotency_key_unique" UNIQUE("execution_idempotency_key")
);
--> statement-breakpoint
CREATE TABLE "outreach_activities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"gold_account_id" uuid,
	"breakfast_event_id" uuid,
	"folk_person_link_id" uuid,
	"channel" text NOT NULL,
	"direction" text NOT NULL,
	"owner_user_id" uuid,
	"actor_agent_id" uuid,
	"conversation_key" text,
	"reply_to_activity_id" uuid,
	"subject" text,
	"body_preview" text,
	"source_system" text NOT NULL,
	"folk_interaction_id" text,
	"idempotency_key" text,
	"execution_status" text DEFAULT 'logged' NOT NULL,
	"visibility_restricted" boolean DEFAULT false NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"synced_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "outreach_activities_folk_interaction_id_unique" UNIQUE("folk_interaction_id"),
	CONSTRAINT "outreach_activities_idempotency_key_unique" UNIQUE("idempotency_key")
);
--> statement-breakpoint
CREATE TABLE "sync_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source" text NOT NULL,
	"scope" text NOT NULL,
	"status" text NOT NULL,
	"records_read" integer DEFAULT 0 NOT NULL,
	"visibility_gap_note" text,
	"error_summary" text,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"clerk_user_id" text,
	"email" text NOT NULL,
	"name" text,
	"role" text DEFAULT 'admin' NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_clerk_user_id_unique" UNIQUE("clerk_user_id"),
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
ALTER TABLE "agent_identities" ADD CONSTRAINT "agent_identities_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_actor_agent_id_agent_identities_id_fk" FOREIGN KEY ("actor_agent_id") REFERENCES "public"."agent_identities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_initiating_user_id_users_id_fk" FOREIGN KEY ("initiating_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "breakfast_events" ADD CONSTRAINT "breakfast_events_logistics_owner_user_id_users_id_fk" FOREIGN KEY ("logistics_owner_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "breakfast_hosts" ADD CONSTRAINT "breakfast_hosts_event_id_breakfast_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."breakfast_events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "breakfast_hosts" ADD CONSTRAINT "breakfast_hosts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "breakfast_invitation_history" ADD CONSTRAINT "breakfast_invitation_history_invitation_id_breakfast_invitations_id_fk" FOREIGN KEY ("invitation_id") REFERENCES "public"."breakfast_invitations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "breakfast_invitation_history" ADD CONSTRAINT "breakfast_invitation_history_changed_by_user_id_users_id_fk" FOREIGN KEY ("changed_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "breakfast_invitations" ADD CONSTRAINT "breakfast_invitations_event_id_breakfast_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."breakfast_events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "breakfast_invitations" ADD CONSTRAINT "breakfast_invitations_folk_person_link_id_folk_people_link_id_fk" FOREIGN KEY ("folk_person_link_id") REFERENCES "public"."folk_people_link"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "breakfast_invitations" ADD CONSTRAINT "breakfast_invitations_carried_forward_from_event_id_breakfast_events_id_fk" FOREIGN KEY ("carried_forward_from_event_id") REFERENCES "public"."breakfast_events"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "change_proposals" ADD CONSTRAINT "change_proposals_proposed_by_agent_id_agent_identities_id_fk" FOREIGN KEY ("proposed_by_agent_id") REFERENCES "public"."agent_identities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "change_proposals" ADD CONSTRAINT "change_proposals_proposed_by_user_id_users_id_fk" FOREIGN KEY ("proposed_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "change_proposals" ADD CONSTRAINT "change_proposals_reviewed_by_user_id_users_id_fk" FOREIGN KEY ("reviewed_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "folk_people_link" ADD CONSTRAINT "folk_people_link_folk_company_link_id_folk_companies_link_id_fk" FOREIGN KEY ("folk_company_link_id") REFERENCES "public"."folk_companies_link"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "follow_up_actions" ADD CONSTRAINT "follow_up_actions_gold_account_id_gold_accounts_id_fk" FOREIGN KEY ("gold_account_id") REFERENCES "public"."gold_accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "follow_up_actions" ADD CONSTRAINT "follow_up_actions_breakfast_event_id_breakfast_events_id_fk" FOREIGN KEY ("breakfast_event_id") REFERENCES "public"."breakfast_events"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "follow_up_actions" ADD CONSTRAINT "follow_up_actions_folk_person_link_id_folk_people_link_id_fk" FOREIGN KEY ("folk_person_link_id") REFERENCES "public"."folk_people_link"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "follow_up_actions" ADD CONSTRAINT "follow_up_actions_activity_id_outreach_activities_id_fk" FOREIGN KEY ("activity_id") REFERENCES "public"."outreach_activities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "follow_up_actions" ADD CONSTRAINT "follow_up_actions_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "follow_up_actions" ADD CONSTRAINT "follow_up_actions_flagged_by_reply_activity_id_outreach_activities_id_fk" FOREIGN KEY ("flagged_by_reply_activity_id") REFERENCES "public"."outreach_activities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gold_accounts" ADD CONSTRAINT "gold_accounts_folk_company_link_id_folk_companies_link_id_fk" FOREIGN KEY ("folk_company_link_id") REFERENCES "public"."folk_companies_link"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gold_accounts" ADD CONSTRAINT "gold_accounts_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message_approvals" ADD CONSTRAINT "message_approvals_gold_account_id_gold_accounts_id_fk" FOREIGN KEY ("gold_account_id") REFERENCES "public"."gold_accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message_approvals" ADD CONSTRAINT "message_approvals_breakfast_event_id_breakfast_events_id_fk" FOREIGN KEY ("breakfast_event_id") REFERENCES "public"."breakfast_events"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message_approvals" ADD CONSTRAINT "message_approvals_folk_person_link_id_folk_people_link_id_fk" FOREIGN KEY ("folk_person_link_id") REFERENCES "public"."folk_people_link"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message_approvals" ADD CONSTRAINT "message_approvals_sender_user_id_users_id_fk" FOREIGN KEY ("sender_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message_approvals" ADD CONSTRAINT "message_approvals_proposed_by_agent_id_agent_identities_id_fk" FOREIGN KEY ("proposed_by_agent_id") REFERENCES "public"."agent_identities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message_approvals" ADD CONSTRAINT "message_approvals_proposed_by_user_id_users_id_fk" FOREIGN KEY ("proposed_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message_approvals" ADD CONSTRAINT "message_approvals_approved_by_user_id_users_id_fk" FOREIGN KEY ("approved_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message_approvals" ADD CONSTRAINT "message_approvals_linked_activity_id_outreach_activities_id_fk" FOREIGN KEY ("linked_activity_id") REFERENCES "public"."outreach_activities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outreach_activities" ADD CONSTRAINT "outreach_activities_gold_account_id_gold_accounts_id_fk" FOREIGN KEY ("gold_account_id") REFERENCES "public"."gold_accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outreach_activities" ADD CONSTRAINT "outreach_activities_breakfast_event_id_breakfast_events_id_fk" FOREIGN KEY ("breakfast_event_id") REFERENCES "public"."breakfast_events"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outreach_activities" ADD CONSTRAINT "outreach_activities_folk_person_link_id_folk_people_link_id_fk" FOREIGN KEY ("folk_person_link_id") REFERENCES "public"."folk_people_link"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outreach_activities" ADD CONSTRAINT "outreach_activities_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outreach_activities" ADD CONSTRAINT "outreach_activities_actor_agent_id_agent_identities_id_fk" FOREIGN KEY ("actor_agent_id") REFERENCES "public"."agent_identities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "audit_events_created_at_idx" ON "audit_events" USING btree ("created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "breakfast_hosts_event_user_uidx" ON "breakfast_hosts" USING btree ("event_id","user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "breakfast_invitations_event_person_uidx" ON "breakfast_invitations" USING btree ("event_id","folk_person_link_id");--> statement-breakpoint
CREATE INDEX "follow_up_actions_due_date_idx" ON "follow_up_actions" USING btree ("due_date");--> statement-breakpoint
CREATE INDEX "outreach_activities_occurred_at_idx" ON "outreach_activities" USING btree ("occurred_at");