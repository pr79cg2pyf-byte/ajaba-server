// Ajaba Server — Express 4 application entry point (v0.7)

import express from 'express';
import cors from 'cors';
import authRoutes from './routes/auth';
import taskRoutes from './routes/tasks';
import templateRoutes from './routes/taskTemplates';
import supplierRoutes from './routes/suppliers';
import creditRoutes from './routes/credits';
import { startScheduler } from './services/scheduler';

const app = express();
const PORT = parseInt(process.env.PORT || '8787', 10);

// Middleware
app.use(cors());
app.use(express.json({ limit: '10mb' }));

// Routes
app.use('/api', authRoutes);
app.use('/api/tasks', taskRoutes);
app.use('/api/task-templates', templateRoutes);
app.use('/api/suppliers', supplierRoutes);
app.use('/api/credits', creditRoutes);

// Start
app.listen(PORT, () => {
  console.log(`\n🚀 Ajaba Server v0.7 running on http://localhost:${PORT}`);
  console.log(`   Health:     http://localhost:${PORT}/api/health`);
  console.log(`   Login:      POST http://localhost:${PORT}/api/auth/login`);
  console.log(`   Tasks:      http://localhost:${PORT}/api/tasks`);
  console.log(`   Templates:  http://localhost:${PORT}/api/task-templates`);
  console.log(`   Suppliers:  http://localhost:${PORT}/api/suppliers`);
  console.log(`   Credits:    http://localhost:${PORT}/api/credits\n`);

  // Start the scheduler after server is listening
  startScheduler();
});

export default app;
