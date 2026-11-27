import { z } from "zod";

export const folkPaginationSchema = z
  .object({
    nextLink: z.string().nullable().optional(),
    nextCursor: z.string().nullable().optional(),
    totalCount: z.number().optional(),
  })
  .passthrough();

export const folkUserSchema = z
  .object({
    id: z.string(),
    fullName: z.string().nullable().optional(),
    firstName: z.string().nullable().optional(),
    lastName: z.string().nullable().optional(),
    email: z.string().nullable().optional(),
    role: z.string().nullable().optional(),
  })
  .passthrough();

export const folkGroupSchema = z
  .object({
    id: z.string(),
    name: z.string(),
  })
  .passthrough();

export const folkCustomFieldSchema = z
  .object({
    id: z.string().optional(),
    name: z.string(),
    type: z.string().optional(),
    options: z.array(z.unknown()).optional(),
  })
  .passthrough();

export const folkCompanyRefSchema = z
  .object({
    id: z.string(),
    name: z.string().nullable().optional(),
  })
  .passthrough();

export const folkPersonSchema = z
  .object({
    id: z.string(),
    firstName: z.string().nullable().optional(),
    lastName: z.string().nullable().optional(),
    fullName: z.string().nullable().optional(),
    emails: z.array(z.string()).optional().default([]),
    phones: z.array(z.string()).optional().default([]),
    jobTitle: z.string().nullable().optional(),
    urls: z.array(z.string()).optional().default([]),
    description: z.string().nullable().optional(),
    companies: z.array(folkCompanyRefSchema).optional().default([]),
    groups: z.array(folkGroupSchema).optional().default([]),
    customFieldValues: z.record(z.unknown()).optional(),
    createdAt: z.string().nullable().optional(),
    updatedAt: z.string().nullable().optional(),
  })
  .passthrough();

export const folkCompanySchema = z
  .object({
    id: z.string(),
    name: z.string(),
    description: z.string().nullable().optional(),
    urls: z.array(z.string()).optional().default([]),
    industries: z.array(z.string()).optional().default([]),
    groups: z.array(folkGroupSchema).optional().default([]),
    customFieldValues: z.record(z.unknown()).optional(),
    createdAt: z.string().nullable().optional(),
    updatedAt: z.string().nullable().optional(),
  })
  .passthrough();

export const folkEntityRefSchema = z
  .object({
    id: z.string(),
    object: z.string().optional(),
  })
  .passthrough();

export const folkNoteSchema = z
  .object({
    id: z.string(),
    content: z.string().nullable().optional(),
    visibility: z.string().nullable().optional(),
    entity: folkEntityRefSchema.nullable().optional(),
    createdBy: folkUserSchema.nullable().optional(),
    createdAt: z.string().nullable().optional(),
    updatedAt: z.string().nullable().optional(),
  })
  .passthrough();

export const folkInteractionSchema = z
  .object({
    id: z.string(),
    entity: folkEntityRefSchema.nullable().optional(),
    entities: z.array(folkEntityRefSchema).optional(),
    datetime: z.string().nullable().optional(),
    createdAt: z.string().nullable().optional(),
    title: z.string().nullable().optional(),
    content: z.string().nullable().optional(),
    activityType: z.string().nullable().optional(),
    importedType: z.string().nullable().optional(),
    user: folkUserSchema.nullable().optional(),
    userId: z.string().nullable().optional(),
    threadId: z.string().nullable().optional(),
    conversationId: z.string().nullable().optional(),
    privacyRestricted: z.boolean().optional(),
  })
  .passthrough();

export type FolkPagination = z.infer<typeof folkPaginationSchema>;
export type FolkUser = z.infer<typeof folkUserSchema>;
export type FolkGroup = z.infer<typeof folkGroupSchema>;
export type FolkCustomField = z.infer<typeof folkCustomFieldSchema>;
export type FolkPerson = z.infer<typeof folkPersonSchema>;
export type FolkCompany = z.infer<typeof folkCompanySchema>;
export type FolkNote = z.infer<typeof folkNoteSchema>;
export type FolkInteraction = z.infer<typeof folkInteractionSchema>;

export interface FolkListResponse<T> {
  items: T[];
  pagination?: FolkPagination;
  rawEnvelopeKeys: string[];
}

export interface FolkListParams {
  limit?: number;
  cursor?: string;
}

export interface FolkInteractionListParams extends FolkListParams {
  entityId?: string;
  filterEntityId?: string;
  timeframe?: "past" | "upcoming";
  importedTypes?: string;
  userId?: string;
}

export interface FolkNoteListParams extends FolkListParams {
  query?: string;
  createdAfter?: string;
  createdBefore?: string;
}

export interface FolkUpdatePersonInput {
  firstName?: string | null;
  lastName?: string | null;
  jobTitle?: string | null;
  description?: string | null;
  emails?: string[];
  urls?: string[];
  customFieldValues?: Record<string, unknown>;
}

export interface FolkUpdateCompanyInput {
  name?: string;
  description?: string | null;
  urls?: string[];
  industries?: string[];
  customFieldValues?: Record<string, unknown>;
}

export interface FolkCreateNoteInput {
  entityId: string;
  entityType: "person" | "company";
  content: string;
  visibility?: "public" | "private";
}

export interface FolkCreateInteractionInput {
  entity: {
    id: string;
    object: "person" | "company";
  };
  datetime: string;
  title: string;
  content: string;
  activityType: string;
}

/**
 * Abstraction over Folk CRM operations so governance services and unit tests
 * can swap in deterministic fake clients without touching live Folk data.
 */
export interface FolkClientInterface {
  listUsers(params?: FolkListParams): Promise<FolkListResponse<FolkUser>>;
  listGroups(params?: FolkListParams): Promise<FolkListResponse<FolkGroup>>;
  listGroupCustomFields(
    groupId: string,
    entityType?: "person" | "company",
  ): Promise<FolkListResponse<FolkCustomField>>;
  listPeople(params?: FolkListParams): Promise<FolkListResponse<FolkPerson>>;
  getPerson(personId: string): Promise<FolkPerson>;
  listCompanies(params?: FolkListParams): Promise<FolkListResponse<FolkCompany>>;
  getCompany(companyId: string): Promise<FolkCompany>;
  listNotes(params?: FolkNoteListParams): Promise<FolkListResponse<FolkNote>>;
  listInteractions(
    params?: FolkInteractionListParams,
  ): Promise<FolkListResponse<FolkInteraction>>;
  getInteraction(interactionId: string): Promise<FolkInteraction>;
  updatePerson(
    personId: string,
    input: FolkUpdatePersonInput,
  ): Promise<FolkPerson>;
  updateCompany(
    companyId: string,
    input: FolkUpdateCompanyInput,
  ): Promise<FolkCompany>;
  createNote(input: FolkCreateNoteInput): Promise<FolkNote>;
  createInteraction(
    input: FolkCreateInteractionInput,
  ): Promise<FolkInteraction>;
}
