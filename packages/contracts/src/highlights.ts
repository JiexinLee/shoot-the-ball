import { z } from 'zod';

export const HighlightTypeSchema = z.enum([
  'MADE_BASKET',
  'THREE_POINTER',
  'ASSIST',
  'STEAL',
  'BLOCK',
  'REBOUND',
  'OTHER',
]);
export type HighlightType = z.infer<typeof HighlightTypeSchema>;

export const HighlightUserStatusSchema = z.enum([
  'PENDING',
  'APPROVED',
  'REJECTED',
]);
export type HighlightUserStatus = z.infer<typeof HighlightUserStatusSchema>;

export const HighlightSchema = z.object({
  id: z.string(),
  videoId: z.string(),
  startTime: z.number().min(0),
  endTime: z.number().positive(),
  eventTime: z.number().nonnegative(),
  confidence: z.number().min(0).max(1),
  type: HighlightTypeSchema.default('MADE_BASKET'),
  clipUrl: z.string().optional().nullable(),
  clipStorageKey: z.string().optional().nullable(),
  thumbnailUrl: z.string().optional().nullable(),
  metadata: z.record(z.unknown()).optional().nullable(),
  userStatus: HighlightUserStatusSchema.default('PENDING'),
  selected: z.boolean().default(true),
  deleted: z.boolean().default(false),
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
});
export type Highlight = z.infer<typeof HighlightSchema>;

export const UpdateHighlightRequestSchema = z.object({
  startTime: z.number().min(0).optional(),
  endTime: z.number().positive().optional(),
  userStatus: HighlightUserStatusSchema.optional(),
});
export type UpdateHighlightRequest = z.infer<typeof UpdateHighlightRequestSchema>;

export const HighlightResponseSchema = z.object({ highlight: HighlightSchema });
export const HighlightsResponseSchema = z.object({
  highlights: z.array(HighlightSchema),
});
