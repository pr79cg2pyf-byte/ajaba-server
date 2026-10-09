"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.startServer = startServer;
const app_1 = require("./app");
const migrate_1 = require("./db/migrate");
const scheduler_1 = require("./services/scheduler");
const app = (0, app_1.createApp)();
exports.default = app;
async function startServer() {
    await (0, migrate_1.migrate)();
    const port = Number(process.env.PORT || 3020);
    const server = app.listen(port, process.env.HOST || '0.0.0.0', () => {
        const address = server.address();
        const actualPort = typeof address === 'object' && address ? address.port : port;
        console.log(`Ajaba Server running on http://localhost:${actualPort}`);
        if (process.env.AJABA_DISABLE_SCHEDULER !== '1' && process.env.NODE_ENV !== 'test')
            (0, scheduler_1.startScheduler)();
    });
    return server;
}
if (require.main === module)
    startServer().catch(error => { console.error(error); process.exitCode = 1; });
//# sourceMappingURL=server.js.map