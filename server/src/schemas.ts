import { z } from "zod";

const contentTypeSchema = z.enum(["text", "image", "carousel", "video", "article"]);

const postSchema = z.object({
  id: z.string().min(1),
  content_preview: z.string().optional(),
  content_type: contentTypeSchema,
  published_at: z.string().datetime({ offset: true }),
  url: z.string().optional(),
});

const postMetricsSchema = z.object({
  post_id: z.string().min(1),
  impressions: z.number().int().optional(),
  members_reached: z.number().int().optional(),
  reactions: z.number().int().optional(),
  comments: z.number().int().optional(),
  reposts: z.number().int().optional(),
  saves: z.number().int().optional(),
  sends: z.number().int().optional(),
  video_views: z.number().int().optional(),
  watch_time_seconds: z.number().int().optional(),
  avg_watch_time_seconds: z.number().int().optional(),
});

const followersSchema = z.object({
  total_followers: z.number().int(),
});

const profileSchema = z.object({
  profile_views: z.number().int().optional(),
  search_appearances: z.number().int().optional(),
  all_appearances: z.number().int().optional(),
});

export const ingestPayloadSchema = z.object({
  posts: z.array(postSchema).optional(),
  post_metrics: z.array(postMetricsSchema).optional(),
  followers: followersSchema.optional(),
  profile: profileSchema.optional(),
});

export type IngestPayload = z.infer<typeof ingestPayloadSchema>;
