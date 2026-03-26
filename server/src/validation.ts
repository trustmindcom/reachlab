import type { ZodSchema } from "zod";

export function validateBody<T>(schema: ZodSchema<T>, body: unknown): T {
  const result = schema.safeParse(body);
  if (!result.success) {
    const message = result.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join(", ");
    throw Object.assign(new Error(message), { statusCode: 400 });
  }
  return result.data;
}
