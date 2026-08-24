"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const multer_1 = __importDefault(require("multer"));
const uploadService_1 = require("../services/uploadService");
const authMiddleware_1 = require("../middleware/authMiddleware");
const redisClient_1 = __importDefault(require("../services/redisClient"));
const router = (0, express_1.Router)();
const storage = multer_1.default.memoryStorage();
const upload = (0, multer_1.default)({ storage });
router.get('/status/:uploadId', authMiddleware_1.authenticateJWT, async (req, res) => {
    try {
        const { uploadId } = req.params;
        const metadata = await redisClient_1.default.hGetAll(`upload:${uploadId}`);
        if (!metadata || !metadata.userId) {
            return res.status(404).json({ error: 'Upload session not found' });
        }
        if (metadata.userId !== req.user.id) {
            return res.status(403).json({ error: 'Unauthorized' });
        }
        const receivedChunks = await redisClient_1.default.sMembers(`upload:${uploadId}:chunks`);
        const receivedChunksInt = receivedChunks.map(c => parseInt(c, 10)).sort((a, b) => a - b);
        res.status(200).json({
            uploadId,
            totalSize: metadata.totalSize,
            receivedChunks: receivedChunksInt
        });
    }
    catch (error) {
        console.error('Error in /status:', error);
        res.status(500).json({ error: error.message });
    }
});
router.post('/init', authMiddleware_1.authenticateJWT, async (req, res) => {
    try {
        const { filename, totalSize } = req.body;
        if (!filename || !totalSize) {
            return res.status(400).json({ error: 'filename and totalSize are required' });
        }
        const uploadId = await (0, uploadService_1.initializeUpload)(filename, totalSize, req.user.id);
        res.status(200).json({ uploadId });
    }
    catch (error) {
        console.error('Error in /init:', error);
        res.status(500).json({ error: error.message });
    }
});
router.post('/chunk', authMiddleware_1.authenticateJWT, upload.single('chunk'), async (req, res) => {
    try {
        const { uploadId, chunkIndex } = req.body;
        const file = req.file;
        if (!uploadId || chunkIndex === undefined || !file) {
            return res.status(400).json({ error: 'uploadId, chunkIndex, and chunk file are required' });
        }
        await (0, uploadService_1.receiveChunk)(uploadId, parseInt(chunkIndex, 10), file.buffer, req.user.id);
        res.status(200).json({ success: true, message: `Chunk ${chunkIndex} received` });
    }
    catch (error) {
        console.error(`Error in /chunk for index ${req.body.chunkIndex}:`, error);
        res.status(500).json({ error: error.message });
    }
});
router.post('/complete', authMiddleware_1.authenticateJWT, async (req, res) => {
    try {
        const { uploadId, totalChunks } = req.body;
        if (!uploadId || totalChunks === undefined) {
            return res.status(400).json({ error: 'uploadId and totalChunks are required' });
        }
        const finalPath = await (0, uploadService_1.completeUpload)(uploadId, parseInt(totalChunks, 10), req.user.id);
        res.status(200).json({ success: true, finalPath });
    }
    catch (error) {
        console.error('Error in /complete:', error);
        res.status(500).json({ error: error.message });
    }
});
exports.default = router;
