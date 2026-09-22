import { z } from 'zod';

export const ProjectSchema = z.object({
  id: z.string(),
  userId: z.string(),
  name: z.string().min(1).max(128),
  coverUrl: z.string().url().nullable().optional(),
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
});
export type Project = z.infer<typeof ProjectSchema>;

export const CreateProjectRequestSchema = z.object({
  name: z.string().min(1).max(128),
  coverUrl: z.string().url().optional().nullable(),
});
export type CreateProjectRequest = z.infer<typeof CreateProjectRequestSchema>;

export const UpdateProjectRequestSchema = CreateProjectRequestSchema.partial();
export type UpdateProjectRequest = z.infer<typeof UpdateProjectRequestSchema>;

export const ProjectResponseSchema = z.object({ project: ProjectSchema });
export const ProjectListResponseSchema = z.object({
  projects: z.array(ProjectSchema),
});
export type ProjectResponse = z.infer<typeof ProjectResponseSchema>;
export type ProjectListResponse = z.infer<typeof ProjectListResponseSchema>;
