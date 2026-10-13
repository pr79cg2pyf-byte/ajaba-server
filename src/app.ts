import express from 'express';
import cors from 'cors';
import authRoutes from './routes/auth';
import taskRoutes from './routes/tasks';
import templateRoutes from './routes/taskTemplates';
import supplierRoutes from './routes/suppliers';
import creditRoutes from './routes/credits';
import dashboardRoutes from './routes/dashboard';
import expiryRoutes from './routes/expiryRecords';
import productRoutes from './routes/products';

export function createApp() {
  const app = express();
  app.use(cors());
  app.use('/api/products', express.json({ limit: '25mb' }), productRoutes);
  app.use(express.json({ limit: '10mb' }));
  app.use('/api', authRoutes);
  app.use('/api/tasks', taskRoutes);
  app.use('/api/task-templates', templateRoutes);
  app.use('/api/suppliers', supplierRoutes);
  app.use('/api/credits', creditRoutes);
  app.use('/api/dashboard', dashboardRoutes);
  app.use('/api/expiry-records', expiryRoutes);
  app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    console.error('[api] Request failed:', error);
    res.status(500).json({ error: 'Server could not persist this request. Please retry.' });
  });
  return app;
}
