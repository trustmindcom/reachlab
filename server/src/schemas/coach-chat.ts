import { z } from "zod";

export const coachChatBody = z.object({
  session_id: z.number().int().positive().nullable(),
  message: z.string().trim().min(1).max(10000),
});

export const createSessionBody = z.object({
  title: z.string().trim().max(200).optional(),
});
