import { z } from "zod";

export const scrapeErrorBody = z.object({
  error_type: z.string().min(1),
  page_type: z.string().min(1),
  selector: z.string().optional(),
  message: z.string().min(1),
});

export const syncStateBody = z.object({
  last_sync_at: z.number().finite(),
});
