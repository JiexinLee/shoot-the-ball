import { z } from 'zod';

export const ProcessingJobStatusSchema = z.enum([
  'UPLOADED',
  'PREPARING',
  'DETECTING',
  'VERIFYING',
  'GENERATING_CLIPS',
  'READY',
  'EXPORTING',
  'EXPORTED',
  'FAILED',
]);
export type ProcessingJobStatus = z.infer<typeof ProcessingJobStatusSchema>;

export const ProcessingJobSchema = z.object({
  id: z.string(),
  videoId: z.string(),
  projectId: z.string(),
  userId: z.string(),
  status: ProcessingJobStatusSchema,
  stage: z.string().optional().nullable(),
  progress: z.number().default(0),
  errorMessage: z.string().optional().nullable(),
  pipelineVersion: z.string().optional().nullable(),
  modelVersion: z.string().optional().nullable(),
  startedAt: z.coerce.date().optional().nullable(),
  completedAt: z.coerce.date().optional().nullable(),
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
});
export type ProcessingJob = z.infer<typeof ProcessingJobSchema>;

export const ProcessVideoResponseSchema = z.object({ jobId: z.string() });
export const JobResponseSchema = z.object({ job: ProcessingJobSchema });
export type ProcessVideoResponse = z.infer<typeof ProcessVideoResponseSchema>;
export type JobResponse = z.infer<typeof JobResponseSchema>;
