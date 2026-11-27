import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

export interface SnoozeHistoryEntry {
  previousDueDate: string;
  newDueDate: string;
  snoozedAt: string;
  snoozedByUserId?: string;
  reason?: string;
}

export const users = pgTable("users", {
  id: uuid("id").defaultRandom().primaryKey(),
  clerkUserId: text("clerk_user_id").unique(),
  email: text("email").notNull().unique(),
  name: text("name"),
  role: text("role").notNull().default("admin"),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

export const agentIdentities = pgTable("agent_identities", {
  id: uuid("id").defaultRandom().primaryKey(),
  name: text("name").notNull(),
  description: text("description"),
  tokenHash: text("token_hash").notNull().unique(),
  tokenPrefix: text("token_prefix").notNull(),
  scopes: jsonb("scopes").$type<string[]>().notNull(),
  createdByUserId: uuid("created_by_user_id").references(() => users.id),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
  lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const auditEvents = pgTable(
  "audit_events",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    actorType: text("actor_type").$type<"human" | "agent" | "system">().notNull(),
    actorUserId: uuid("actor_user_id").references(() => users.id),
    actorAgentId: uuid("actor_agent_id").references(() => agentIdentities.id),
    initiatingUserId: uuid("initiating_user_id").references(() => users.id),
    action: text("action").notNull(),
    entityType: text("entity_type").notNull(),
    entityId: text("entity_id"),
    fieldName: text("field_name"),
    previousValueJson: jsonb("previous_value_json"),
    newValueJson: jsonb("new_value_json"),
    source: text("source"),
    evidenceDate: timestamp("evidence_date", { withTimezone: true }),
    outcome: text("outcome")
      .$type<"succeeded" | "denied" | "failed" | "pending">()
      .notNull(),
    metadataJson: jsonb("metadata_json"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [index("audit_events_created_at_idx").on(table.createdAt)],
);

export const folkCompaniesLink = pgTable("folk_companies_link", {
  id: uuid("id").defaultRandom().primaryKey(),
  folkCompanyId: text("folk_company_id").notNull().unique(),
  name: text("name").notNull(),
  domain: text("domain"),
  lastSyncedAt: timestamp("last_synced_at", { withTimezone: true }),
  syncStatus: text("sync_status").notNull().default("linked"),
  syncError: text("sync_error"),
  snapshotJson: jsonb("snapshot_json").$type<Record<string, unknown>>(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

export const folkPeopleLink = pgTable("folk_people_link", {
  id: uuid("id").defaultRandom().primaryKey(),
  folkPersonId: text("folk_person_id").notNull().unique(),
  folkCompanyLinkId: uuid("folk_company_link_id").references(() => folkCompaniesLink.id),
  fullName: text("full_name").notNull(),
  email: text("email"),
  jobTitle: text("job_title"),
  linkedinUrl: text("linkedin_url"),
  folkOwnerId: text("folk_owner_id"),
  contactSuppressed: boolean("contact_suppressed").notNull().default(false),
  suppressionReason: text("suppression_reason"),
  suppressedAt: timestamp("suppressed_at", { withTimezone: true }),
  lastSyncedAt: timestamp("last_synced_at", { withTimezone: true }),
  syncStatus: text("sync_status").notNull().default("linked"),
  syncError: text("sync_error"),
  snapshotJson: jsonb("snapshot_json").$type<Record<string, unknown>>(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

export const syncRuns = pgTable("sync_runs", {
  id: uuid("id").defaultRandom().primaryKey(),
  source: text("source").notNull(),
  scope: text("scope").notNull(),
  status: text("status")
    .$type<"running" | "succeeded" | "partial" | "failed">()
    .notNull(),
  recordsRead: integer("records_read").notNull().default(0),
  visibilityGapNote: text("visibility_gap_note"),
  errorSummary: text("error_summary"),
  startedAt: timestamp("started_at", { withTimezone: true }).defaultNow().notNull(),
  finishedAt: timestamp("finished_at", { withTimezone: true }),
});

export const breakfastEvents = pgTable("breakfast_events", {
  id: uuid("id").defaultRandom().primaryKey(),
  locale: text("locale").notNull(),
  title: text("title").notNull(),
  eventDate: timestamp("event_date", { withTimezone: true }).notNull(),
  venueName: text("venue_name"),
  venueAddress: text("venue_address"),
  totalCapacity: integer("total_capacity").notNull().default(14),
  status: text("status")
    .$type<"planning" | "inviting" | "confirmed" | "completed" | "cancelled">()
    .notNull()
    .default("planning"),
  bookingStatus: text("booking_status").default("unconfirmed"),
  bookingReference: text("booking_reference"),
  venueContact: text("venue_contact"),
  bookingDocsUrl: text("booking_docs_url"),
  depositAmountPence: integer("deposit_amount_pence"),
  depositDueDate: timestamp("deposit_due_date", { withTimezone: true }),
  depositInvoiceRef: text("deposit_invoice_ref"),
  depositPaid: boolean("deposit_paid").notNull().default(false),
  balanceAmountPence: integer("balance_amount_pence"),
  balanceDueDate: timestamp("balance_due_date", { withTimezone: true }),
  balanceInvoiceRef: text("balance_invoice_ref"),
  balancePaid: boolean("balance_paid").notNull().default(false),
  logisticsOwnerUserId: uuid("logistics_owner_user_id").references(() => users.id),
  prereadUrl: text("preread_url"),
  prereadNotes: text("preread_notes"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

export const breakfastHosts = pgTable(
  "breakfast_hosts",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    eventId: uuid("event_id")
      .notNull()
      .references(() => breakfastEvents.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    attending: boolean("attending").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("breakfast_hosts_event_user_uidx").on(table.eventId, table.userId),
  ],
);

export const breakfastInvitations = pgTable(
  "breakfast_invitations",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    eventId: uuid("event_id")
      .notNull()
      .references(() => breakfastEvents.id, { onDelete: "cascade" }),
    folkPersonLinkId: uuid("folk_person_link_id")
      .notNull()
      .references(() => folkPeopleLink.id),
    responseStatus: text("response_status")
      .$type<"provisional" | "no_response" | "accepted" | "maybe" | "declined">()
      .notNull()
      .default("provisional"),
    attendanceOutcome: text("attendance_outcome")
      .$type<"pending" | "attended" | "cancelled_in_advance" | "no_show">()
      .notNull()
      .default("pending"),
    waitlistStatus: text("waitlist_status")
      .$type<"none" | "waitlisted" | "offered_place" | "confirmed_replacement">()
      .notNull()
      .default("none"),
    chaseStatus: text("chase_status").notNull().default("none"),
    carriedForwardFromEventId: uuid("carried_forward_from_event_id").references(
      () => breakfastEvents.id,
    ),
    dietaryNotes: text("dietary_notes"),
    specialRequests: text("special_requests"),
    earlyDepartureNote: text("early_departure_note"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("breakfast_invitations_event_person_uidx").on(
      table.eventId,
      table.folkPersonLinkId,
    ),
  ],
);

export const breakfastInvitationHistory = pgTable("breakfast_invitation_history", {
  id: uuid("id").defaultRandom().primaryKey(),
  invitationId: uuid("invitation_id")
    .notNull()
    .references(() => breakfastInvitations.id, { onDelete: "cascade" }),
  changedByUserId: uuid("changed_by_user_id").references(() => users.id),
  previousResponseStatus: text("previous_response_status"),
  newResponseStatus: text("new_response_status"),
  previousAttendanceOutcome: text("previous_attendance_outcome"),
  newAttendanceOutcome: text("new_attendance_outcome"),
  previousWaitlistStatus: text("previous_waitlist_status"),
  newWaitlistStatus: text("new_waitlist_status"),
  note: text("note"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const localeCarryForwardQueue = pgTable(
  "locale_carry_forward_queue",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    locale: text("locale").notNull(),
    folkPersonLinkId: uuid("folk_person_link_id")
      .notNull()
      .references(() => folkPeopleLink.id),
    sourceEventId: uuid("source_event_id")
      .notNull()
      .references(() => breakfastEvents.id, { onDelete: "cascade" }),
    reason: text("reason")
      .$type<"responded_could_not_attend" | "manual_queue">()
      .notNull()
      .default("responded_could_not_attend"),
    consumedByEventId: uuid("consumed_by_event_id").references(
      () => breakfastEvents.id,
      { onDelete: "set null" },
    ),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("locale_carry_forward_queue_uidx").on(
      table.locale,
      table.folkPersonLinkId,
      table.sourceEventId,
    ),
  ],
);

export const breakfastFeedback = pgTable("breakfast_feedback", {
  id: uuid("id").defaultRandom().primaryKey(),
  eventId: uuid("event_id")
    .notNull()
    .references(() => breakfastEvents.id, { onDelete: "cascade" }),
  recordedByUserId: uuid("recorded_by_user_id").references(() => users.id),
  category: text("category")
    .$type<"event" | "format" | "venue" | "attendee_mix" | "content">()
    .notNull()
    .default("event"),
  summary: text("summary").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const breakfastReferrals = pgTable("breakfast_referrals", {
  id: uuid("id").defaultRandom().primaryKey(),
  eventId: uuid("event_id")
    .notNull()
    .references(() => breakfastEvents.id, { onDelete: "cascade" }),
  referredByFolkPersonLinkId: uuid("referred_by_folk_person_link_id").references(
    () => folkPeopleLink.id,
  ),
  referredName: text("referred_name").notNull(),
  referredCompany: text("referred_company"),
  referredRole: text("referred_role"),
  referredEmail: text("referred_email"),
  status: text("status")
    .$type<"new" | "researching" | "added_to_folk" | "invited" | "dismissed">()
    .notNull()
    .default("new"),
  notes: text("notes"),
  createdByUserId: uuid("created_by_user_id").references(() => users.id),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

export const goldAccounts = pgTable("gold_accounts", {
  id: uuid("id").defaultRandom().primaryKey(),
  folkCompanyLinkId: uuid("folk_company_link_id")
    .notNull()
    .unique()
    .references(() => folkCompaniesLink.id),
  ownerUserId: uuid("owner_user_id")
    .notNull()
    .references(() => users.id),
  status: text("status").$type<"active" | "archived">().notNull().default("active"),
  marketingTeamSize: integer("marketing_team_size"),
  legacySetupNotes: text("legacy_setup_notes"),
  fitNotes: text("fit_notes"),
  legacyScoreMetadataJson: jsonb("legacy_score_metadata_json").$type<Record<string, unknown>>(),
  lastInteractionsSyncAt: timestamp("last_interactions_sync_at", { withTimezone: true }),
  lastInteractionsSyncNote: text("last_interactions_sync_note"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

export const goldAccountContacts = pgTable("gold_account_contacts", {
  id: uuid("id").defaultRandom().primaryKey(),
  goldAccountId: uuid("gold_account_id")
    .notNull()
    .references(() => goldAccounts.id, { onDelete: "cascade" }),
  folkPersonLinkId: uuid("folk_person_link_id").references(
    () => folkPeopleLink.id,
  ),
  roleCategory: text("role_category")
    .$type<"cmo" | "vp_marketing" | "marketing_director" | "marketing_ops" | "other">()
    .notNull(),
  isPrimaryDecisionMaker: boolean("is_primary_decision_maker")
    .notNull()
    .default(false),
  coverageStatus: text("coverage_status")
    .$type<"mapped" | "gap" | "former">()
    .notNull()
    .default("mapped"),
  notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

export const accountIntelligence = pgTable("account_intelligence", {
  id: uuid("id").defaultRandom().primaryKey(),
  goldAccountId: uuid("gold_account_id")
    .notNull()
    .references(() => goldAccounts.id, { onDelete: "cascade" }),
  dimension: text("dimension")
    .$type<"team" | "process" | "data" | "tech">()
    .notNull(),
  summary: text("summary").notNull(),
  factType: text("fact_type")
    .$type<"verified" | "interpretation" | "unknown">()
    .notNull()
    .default("verified"),
  evidenceDate: timestamp("evidence_date", { withTimezone: true }),
  observedAt: timestamp("observed_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
  sourceUrl: text("source_url"),
  sourceNote: text("source_note"),
  recordedByUserId: uuid("recorded_by_user_id").references(() => users.id),
  recordedByAgentId: uuid("recorded_by_agent_id").references(
    () => agentIdentities.id,
  ),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const buyingSignals = pgTable("buying_signals", {
  id: uuid("id").defaultRandom().primaryKey(),
  goldAccountId: uuid("gold_account_id")
    .notNull()
    .references(() => goldAccounts.id, { onDelete: "cascade" }),
  signalType: text("signal_type")
    .$type<
      | "leadership_change"
      | "funding"
      | "consolidation"
      | "integration"
      | "acquisition"
      | "other"
    >()
    .notNull(),
  title: text("title").notNull(),
  details: text("details"),
  factType: text("fact_type")
    .$type<"verified" | "interpretation" | "unknown">()
    .notNull()
    .default("verified"),
  signalDate: timestamp("signal_date", { withTimezone: true }),
  observedAt: timestamp("observed_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
  sourceUrl: text("source_url"),
  sourceNote: text("source_note"),
  recordedByUserId: uuid("recorded_by_user_id").references(() => users.id),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const outreachActivities = pgTable(
  "outreach_activities",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    goldAccountId: uuid("gold_account_id").references(() => goldAccounts.id),
    breakfastEventId: uuid("breakfast_event_id").references(() => breakfastEvents.id),
    folkPersonLinkId: uuid("folk_person_link_id").references(() => folkPeopleLink.id),
    channel: text("channel")
      .$type<"email" | "linkedin" | "postcard" | "call" | "meeting" | "other">()
      .notNull(),
    direction: text("direction").$type<"outbound" | "inbound" | "note">().notNull(),
    ownerUserId: uuid("owner_user_id").references(() => users.id),
    actorAgentId: uuid("actor_agent_id").references(() => agentIdentities.id),
    conversationKey: text("conversation_key"),
    replyToActivityId: uuid("reply_to_activity_id"),
    subject: text("subject"),
    bodyPreview: text("body_preview"),
    sourceSystem: text("source_system")
      .$type<"folk_gmail" | "folk_logged" | "tracker_manual" | "agent">()
      .notNull(),
    folkInteractionId: text("folk_interaction_id").unique(),
    idempotencyKey: text("idempotency_key").unique(),
    executionStatus: text("execution_status")
      .$type<"logged" | "sent" | "failed" | "outcome_unknown">()
      .notNull()
      .default("logged"),
    visibilityRestricted: boolean("visibility_restricted").notNull().default(false),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
    syncedAt: timestamp("synced_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [index("outreach_activities_occurred_at_idx").on(table.occurredAt)],
);

export const followUpActions = pgTable(
  "follow_up_actions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    goldAccountId: uuid("gold_account_id").references(() => goldAccounts.id),
    breakfastEventId: uuid("breakfast_event_id").references(() => breakfastEvents.id),
    folkPersonLinkId: uuid("folk_person_link_id").references(() => folkPeopleLink.id),
    activityId: uuid("activity_id").references(() => outreachActivities.id),
    ownerUserId: uuid("owner_user_id")
      .notNull()
      .references(() => users.id),
    title: text("title").notNull(),
    notes: text("notes"),
    dueDate: timestamp("due_date", { withTimezone: true }).notNull(),
    status: text("status")
      .$type<"open" | "needs_review" | "completed" | "cancelled">()
      .notNull()
      .default("open"),
    flaggedByReplyActivityId: uuid("flagged_by_reply_activity_id").references(
      () => outreachActivities.id,
    ),
    snoozeHistoryJson: jsonb("snooze_history_json")
      .$type<SnoozeHistoryEntry[]>()
      .notNull()
      .default([]),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [index("follow_up_actions_due_date_idx").on(table.dueDate)],
);

export const changeProposals = pgTable("change_proposals", {
  id: uuid("id").defaultRandom().primaryKey(),
  targetSystem: text("target_system").$type<"folk" | "tracker">().notNull(),
  entityType: text("entity_type")
    .$type<"person" | "company" | "gold_account" | "breakfast_event">()
    .notNull(),
  entityId: text("entity_id").notNull(),
  folkRecordId: text("folk_record_id"),
  proposedByAgentId: uuid("proposed_by_agent_id").references(() => agentIdentities.id),
  proposedByUserId: uuid("proposed_by_user_id").references(() => users.id),
  summary: text("summary").notNull(),
  proposedChangesJson: jsonb("proposed_changes_json")
    .$type<Record<string, unknown>>()
    .notNull(),
  baseSnapshotJson: jsonb("base_snapshot_json")
    .$type<Record<string, unknown>>()
    .notNull(),
  payloadHash: text("payload_hash").notNull(),
  sourceUrl: text("source_url"),
  sourceNote: text("source_note"),
  factType: text("fact_type")
    .$type<"verified" | "interpretation" | "unknown">()
    .notNull()
    .default("verified"),
  evidenceDate: timestamp("evidence_date", { withTimezone: true }),
  observedAt: timestamp("observed_at", { withTimezone: true }).defaultNow().notNull(),
  status: text("status")
    .$type<
      "pending_review" | "approved" | "rejected" | "conflict" | "applied" | "failed"
    >()
    .notNull()
    .default("pending_review"),
  reviewedByUserId: uuid("reviewed_by_user_id").references(() => users.id),
  reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
  reviewNote: text("review_note"),
  appliedAt: timestamp("applied_at", { withTimezone: true }),
  applyError: text("apply_error"),
  idempotencyKey: text("idempotency_key").unique(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

export const messageApprovals = pgTable("message_approvals", {
  id: uuid("id").defaultRandom().primaryKey(),
  goldAccountId: uuid("gold_account_id").references(() => goldAccounts.id),
  breakfastEventId: uuid("breakfast_event_id").references(() => breakfastEvents.id),
  folkPersonLinkId: uuid("folk_person_link_id").references(() => folkPeopleLink.id),
  senderUserId: uuid("sender_user_id")
    .notNull()
    .references(() => users.id),
  recipientName: text("recipient_name").notNull(),
  recipientAddress: text("recipient_address").notNull(),
  channel: text("channel").$type<"email" | "linkedin" | "other">().notNull(),
  subject: text("subject"),
  body: text("body").notNull(),
  contentHash: text("content_hash").notNull(),
  proposedByAgentId: uuid("proposed_by_agent_id").references(() => agentIdentities.id),
  proposedByUserId: uuid("proposed_by_user_id").references(() => users.id),
  status: text("status")
    .$type<
      | "draft"
      | "awaiting_approval"
      | "approved"
      | "rejected"
      | "sent"
      | "failed"
      | "outcome_unknown"
    >()
    .notNull()
    .default("awaiting_approval"),
  approvedByUserId: uuid("approved_by_user_id").references(() => users.id),
  approvedAt: timestamp("approved_at", { withTimezone: true }),
  approvalTokenHash: text("approval_token_hash"),
  executionIdempotencyKey: text("execution_idempotency_key").unique(),
  executedAt: timestamp("executed_at", { withTimezone: true }),
  executionNote: text("execution_note"),
  linkedActivityId: uuid("linked_activity_id").references(() => outreachActivities.id),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});
