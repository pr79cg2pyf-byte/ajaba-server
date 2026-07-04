"use strict";
// Ajaba Server — Express 4 application entry point (v0.7)
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const cors_1 = __importDefault(require("cors"));
const auth_1 = __importDefault(require("./routes/auth"));
const tasks_1 = __importDefault(require("./routes/tasks"));
const taskTemplates_1 = __importDefault(require("./routes/taskTemplates"));
const scheduler_1 = require("./services/scheduler");
const app = (0, express_1.default)();
const PORT = parseInt(process.env.PORT || '8787', 10);
// Middleware
app.use((0, cors_1.default)());
app.use(express_1.default.json({ limit: '10mb' }));
// Routes
app.use('/api', auth_1.default);
app.use('/api/tasks', tasks_1.default);
app.use('/api/task-templates', taskTemplates_1.default);
// Start
app.listen(PORT, () => {
    console.log(`\n🚀 Ajaba Server v0.7 running on http://localhost:${PORT}`);
    console.log(`   Health:     http://localhost:${PORT}/api/health`);
    console.log(`   Login:      POST http://localhost:${PORT}/api/auth/login`);
    console.log(`   Tasks:      http://localhost:${PORT}/api/tasks`);
    console.log(`   Templates:  http://localhost:${PORT}/api/task-templates\n`);
    // Start the scheduler after server is listening
    (0, scheduler_1.startScheduler)();
});
exports.default = app;
//# sourceMappingURL=server.js.map