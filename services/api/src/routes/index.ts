import { Router } from 'express';
import { authRouter } from '../modules/auth/auth.routes';
import { projectsRouter } from '../modules/projects/projects.routes';
import { videosRouter } from '../modules/videos/videos.routes';
import { jobsRouter } from '../modules/jobs/jobs.routes';
import { highlightsRouter } from '../modules/highlights/highlights.routes';
import { exportsRouter } from '../modules/exports/exports.routes';

export const apiV1Router = Router();

apiV1Router.get('/health', (_req, res) => {
  res.status(200).json({ status: 'ok', service: 'shoot-the-ball-api', ts: Date.now() });
});

apiV1Router.use('/auth', authRouter);
apiV1Router.use('/projects', projectsRouter);
apiV1Router.use('/videos', videosRouter);
apiV1Router.use('/jobs', jobsRouter);
apiV1Router.use('/highlights', highlightsRouter);
apiV1Router.use('/exports', exportsRouter);
