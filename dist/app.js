"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.createApp = createApp;
const express_1 = __importDefault(require("express"));
const cors_1 = __importDefault(require("cors"));
const auth_1 = __importDefault(require("./routes/auth"));
const tasks_1 = __importDefault(require("./routes/tasks"));
const taskTemplates_1 = __importDefault(require("./routes/taskTemplates"));
const suppliers_1 = __importDefault(require("./routes/suppliers"));
const credits_1 = __importDefault(require("./routes/credits"));
const dashboard_1 = __importDefault(require("./routes/dashboard"));
const expiryRecords_1 = __importDefault(require("./routes/expiryRecords"));
const products_1 = __importDefault(require("./routes/products"));
const build_info_json_1 = __importDefault(require("./build-info.json"));
function createApp() {
    const app = (0, express_1.default)();
    app.use((0, cors_1.default)());
    app.get('/api/version', (_req, res) => {
        const { version } = require('../package.json');
        res.json({ service: 'ajaba-server', version, build: build_info_json_1.default });
    });
    app.use('/api/products', express_1.default.json({ limit: '25mb' }), products_1.default);
    app.use(express_1.default.json({ limit: '10mb' }));
    app.use('/api', auth_1.default);
    app.use('/api/tasks', tasks_1.default);
    app.use('/api/task-templates', taskTemplates_1.default);
    app.use('/api/suppliers', suppliers_1.default);
    app.use('/api/credits', credits_1.default);
    app.use('/api/dashboard', dashboard_1.default);
    app.use('/api/expiry-records', expiryRecords_1.default);
    app.use((error, _req, res, _next) => {
        console.error('[api] Request failed:', error);
        res.status(500).json({ error: 'Server could not persist this request. Please retry.' });
    });
    return app;
}
//# sourceMappingURL=app.js.map