import { createApp } from './app';
import { migrate } from './db/migrate';
import { startScheduler } from './services/scheduler';

const app = createApp();
export default app;
export async function startServer() {
  await migrate();
  const port = Number(process.env.PORT || 3020);
  const server = app.listen(port, process.env.HOST || '0.0.0.0', () => {
    const address = server.address();
    const actualPort = typeof address === 'object' && address ? address.port : port;
    console.log(`Ajaba Server running on http://localhost:${actualPort}`);
    if (process.env.AJABA_DISABLE_SCHEDULER !== '1' && process.env.NODE_ENV !== 'test') startScheduler();
  });
  return server;
}
if (require.main === module) startServer().catch(error => { console.error(error); process.exitCode = 1; });
