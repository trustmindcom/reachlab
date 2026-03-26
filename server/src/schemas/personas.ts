import { z } from "zod";

export const createPersonaBody = z.object({
  name: z.string().min(1),
  linkedin_url: z.string().min(1),
  type: z.string().optional(),
});

export const updatePersonaBody = z.object({
  name: z.string().min(1).optional(),
  linkedin_url: z.string().min(1).optional(),
});
