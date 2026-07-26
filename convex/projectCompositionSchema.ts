import { z } from "zod";

const identifier = z.string().min(1).max(200);
const timing = z.object({
  startMs: z.number().int().nonnegative(),
  endMs: z.number().int().positive(),
});
const anchor = z.discriminatedUnion("kind", [
  timing.extend({ kind: z.literal("time") }),
  timing.extend({ kind: z.literal("beat"), beatId: identifier }),
]);
const segmentBase = z.object({
  id: identifier,
  anchor,
});

export const projectCompositionSchema = z.object({
  schemaVersion: z.literal(1),
  narrationVersionId: identifier,
  fps: z.number().int().min(1).max(120),
  width: z.number().int().min(160).max(7_680),
  height: z.number().int().min(90).max(4_320),
  segments: z
    .array(
      z.discriminatedUnion("kind", [
        segmentBase.extend({
          kind: z.literal("component"),
          componentVersionId: identifier,
          input: z.json(),
        }),
        segmentBase.extend({
          kind: z.literal("media"),
          sourceId: identifier,
          fit: z.enum(["cover", "contain"]),
        }),
      ]),
    )
    .max(500),
});

export type ProjectComposition = z.output<typeof projectCompositionSchema>;
