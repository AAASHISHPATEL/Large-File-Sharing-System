import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import uploadRoutes from './routes/upload';
import authRoutes from './routes/auth';
import path from 'path';
import fs from 'fs';
import { createServer } from 'http';

const app = express();
const PORT = process.env.PORT || 3000;
const httpServer = createServer(app);

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Serve frontend UI
app.use(express.static(path.join(__dirname, '../public')));

// Ensure uploads directory exists
const uploadsDir = path.join(__dirname, '../uploads');
if (!fs.existsSync(uploadsDir)) {
    fs.mkdirSync(uploadsDir, { recursive: true });
}
const finalDir = path.join(__dirname, '../uploads/final');
if (!fs.existsSync(finalDir)) {
    fs.mkdirSync(finalDir, { recursive: true });
}

import { connectRedis } from './services/redisClient';
import { initializeDB } from './config/db';
import { initializeMinio } from './services/minioClient';
import { initializeWebSocket } from './services/websocket';

app.use('/auth', authRoutes);
app.use('/upload', uploadRoutes);

app.get('/health', (req, res) => {
    res.status(200).json({ status: 'ok' });
});

const startServer = async () => {
    try {
        await connectRedis();
        await initializeDB();
        await initializeMinio();
        await initializeWebSocket(httpServer);

        httpServer.listen(PORT, () => {
            console.log(`Server is running on port ${PORT}`);
        });
    } catch (error) {
        console.error('Failed to start server:', error);
        process.exit(1);
    }
};

startServer();
