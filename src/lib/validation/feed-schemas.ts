import { z } from "zod";

// ── Shared field schemas ─────────────────────────────────────

export const feedUrlSchema = z.string().url().max(2048);

const cadenceSchema = z.enum([
  "daily",
  "twice_weekly",
  "weekly",
  "on_new_episodes",
]);

const styleSchema = z.enum(["monologue", "interview", "group_chat"]);

const toneSchema = z.enum([
  "serious",
  "lighthearted",
  "dark_mystery",
  "business_news",
]);

const timeSchema = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Must be HH:MM format (24-hour)");

const timezoneSchema = z.string().min(1).max(64);

// ── Feed management ──────────────────────────────────────────

export const createFeedSchema = z.object({
  feedUrl: feedUrlSchema,
});

export const updateFeedSchema = z.object({
  is_active: z.boolean().optional(),
  title: z.string().max(500).optional(),
});

export const importOpmlSchema = z.object({
  opml: z.string().max(1_000_000),
});

// ── Summary config ───────────────────────────────────────────

export const createSummaryConfigSchema = z.object({
  name: z.string().min(1).max(200),
  cadence: cadenceSchema,
  preferredTime: timeSchema.optional(),
  timezone: timezoneSchema.optional(),
  style: styleSchema,
  tone: toneSchema,
  lengthMinutes: z.number().int().min(1).max(60),
  voiceConfig: z
    .object({
      voices: z.array(
        z.object({
          role: z.string(),
          voice_id: z.string(),
          name: z.string(),
        })
      ),
    })
    .nullable()
    .optional(),
  feedIds: z.array(z.string().uuid()).min(1),
});

export const updateSummaryConfigSchema = createSummaryConfigSchema.partial();

// ── Transcription ────────────────────────────────────────────

export const triggerTranscriptionSchema = z.object({
  feedEpisodeId: z.string().uuid(),
});

// ── Inferred types ───────────────────────────────────────────

export type CreateFeedInput = z.infer<typeof createFeedSchema>;
export type UpdateFeedInput = z.infer<typeof updateFeedSchema>;
export type ImportOpmlInput = z.infer<typeof importOpmlSchema>;
export type CreateSummaryConfigInput = z.infer<
  typeof createSummaryConfigSchema
>;
export type UpdateSummaryConfigInput = z.infer<
  typeof updateSummaryConfigSchema
>;
export type TriggerTranscriptionInput = z.infer<
  typeof triggerTranscriptionSchema
>;
