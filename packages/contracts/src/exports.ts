import { z } from 'zod';

export const ExportTypeSchema = z.enum(['INDIVIDUAL', 'MERGE']);
export type ExportType = z.infer<typeof ExportTypeSchema>;

export const ExportFormatSchema = z.enum(['MP4_HD', 'MP4_FULL_HD', 'MP4_4K']);
export type ExportFormat = z.infer<typeof ExportFormatSchema>;

export const ExportStatusSchema = z.enum([
  'QUEUED',
  'EXPORTING',
  'EXPORTED',
  'FAILED',
]);
export type ExportStatus = z.infer<typeof ExportStatusSchema>;

export const ExportItemSchema = z.object({
  id: z.string(),
  exportId: z.string(),
  highlightId: z.string(),
  orderIndex: z.number().int().nonnegative(),
  startTime: z.number().nonnegative(),
  endTime: z.number().positive(),
  createdAt: z.coerce.date(),
});
export type ExportItem = z.infer<typeof ExportItemSchema>;

export const ExportSchema = z.object({
  id: z.string(),
  projectId: z.string(),
  userId: z.string(),
  type: ExportTypeSchema,
  format: ExportFormatSchema.default('MP4_FULL_HD'),
  status: ExportStatusSchema.default('QUEUED'),
  storageKey: z.string().optional().nullable(),
  downloadUrl: z.string().optional().nullable(),
  sizeBytes: z.bigint().or(z.number()).optional().nullable(),
  duration: z.number().optional().nullable(),
  errorMessage: z.string().optional().nullable(),
  startedAt: z.coerce.date().optional().nullable(),
  completedAt: z.coerce.date().optional().nullable(),
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
  exportItems: z.array(ExportItemSchema).optional(),
});
export type Export = z.infer<typeof ExportSchema>;

export const CreateExportRequestSchema = z.object({
  projectId: z.string().min(1),
  type: ExportTypeSchema,
  format: ExportFormatSchema.default('MP4_FULL_HD'),
  highlightIds: z.array(z.string().min(1)).nonempty(),
});
export type CreateExportRequest = z.infer<typeof CreateExportRequestSchema>;

export const CreateExportResponseSchema = z.object({ export: ExportSchema });
export const GetExportResponseSchema = z.object({
  export: ExportSchema,
  downloadUrl: z.string().optional().nullable(),
});
