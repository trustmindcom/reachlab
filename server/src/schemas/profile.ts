import { z } from "zod";

export const saveProfileBody = z.object({
  profile_text: z.string(),
  profile_json: z.any().optional(),
});

export const interviewBody = z.object({
  transcript: z.string().min(1),
  duration_seconds: z.number().optional(),
});
