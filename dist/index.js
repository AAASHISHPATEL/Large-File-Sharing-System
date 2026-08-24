"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const cors_1 = __importDefault(require("cors"));
const upload_1 = __importDefault(require("./routes/upload"));
const auth_1 = __importDefault(require("./routes/auth"));
const path_1 = __importDefault(require("path"));
const fs_1 = __importDefault(require("fs"));
const http_1 = require("http");
const app = (0, express_1.default)();
const PORT = process.env.PORT || 3000;
const httpServer = (0, http_1.createServer)(app);
app.use((0, cors_1.default)());
app.use(express_1.default.json());
app.use(express_1.default.urlencoded({ extended: true }));
// Serve frontend UI
app.use(express_1.default.static(path_1.default.join(__dirname, '../public')));
// Ensure uploads directory exists
const uploadsDir = path_1.default.join(__dirname, '../uploads');
if (!fs_1.default.existsSync(uploadsDir)) {
    fs_1.default.mkdirSync(uploadsDir, { recursive: true });
}
const finalDir = path_1.default.join(__dirname, '../uploads/final');
if (!fs_1.default.existsSync(finalDir)) {
    fs_1.default.mkdirSync(finalDir, { recursive: true });
}
const redisClient_1 = require("./services/redisClient");
const db_1 = require("./config/db");
const minioClient_1 = require("./services/minioClient");
const websocket_1 = require("./services/websocket");
app.use('/auth', auth_1.default);
app.use('/upload', upload_1.default);
app.get('/health', (req, res) => {
    res.status(200).json({ status: 'ok' });
});
const startServer = async () => {
    try {
        await (0, redisClient_1.connectRedis)();
        await (0, db_1.initializeDB)();
        await (0, minioClient_1.initializeMinio)();
        await (0, websocket_1.initializeWebSocket)(httpServer);
        httpServer.listen(PORT, () => {
            console.log(`Server is running on port ${PORT}`);
        });
    }
    catch (error) {
        console.error('Failed to start server:', error);
        process.exit(1);
    }
};
startServer();
