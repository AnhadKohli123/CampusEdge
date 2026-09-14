import express from 'express';
import cors from 'cors';
import morgan from 'morgan';
import { config } from './config.js';
import { attachUser } from './middleware/auth.js';
import { errorHandler, notFoundHandler } from './middleware/errorHandler.js';
import { query } from './db.js';

import authRoutes from './routes/auth.routes.js';
import studentRoutes from './routes/students.routes.js';
import groupRoutes from './routes/groups.routes.js';
import preferenceRoutes from './routes/preferences.routes.js';
import { groupInviteRouter, inviteRouter } from './routes/invites.routes.js';
import catalogRoutes from './routes/catalog.routes.js';
import allotmentRoutes from './routes/allotments.routes.js';
import adminRoutes from './routes/admin.routes.js';

export function createApp() {
  const app = express();

  app.use(cors({ origin: config.corsOrigin }));
  app.use(express.json({ limit: '1mb' }));
  if (config.env !== 'test') app.use(morgan('dev'));
  app.use(attachUser);

  app.get('/health', async (req, res) => {
    try {
      await query('SELECT 1');
      res.json({ ok: true, semester: config.currentSemester });
    } catch (err) {
      res.status(503).json({ ok: false, error: 'database unreachable' });
    }
  });

  app.use('/api/auth', authRoutes);
  app.use('/api/students', studentRoutes);
  app.use('/api/groups/:groupId/preferences', preferenceRoutes);
  app.use('/api/groups/:groupId/invites', groupInviteRouter);
  app.use('/api/invites', inviteRouter);
  app.use('/api/groups', groupRoutes);
  app.use('/api/catalog', catalogRoutes);
  app.use('/api/allotments', allotmentRoutes);
  app.use('/api/admin', adminRoutes);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
