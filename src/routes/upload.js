"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const multer_1 = __importDefault(require("multer"));
const uploadService_1 = require("../services/uploadService");
const router = (0, express_1.Router)();
// Configure multer to store chunks in memory temporarily before we move them
// Alternatively, we could save directly to disk. For better control, let's parse in memory 
// or use a temp folder. Since chunks are ~5MB, memory is fine for the buffer, 
// but direct to disk is safer to avoid RAM bloat.
const storage = multer_1.default.memoryStorage();
const upload = (0, multer_1.default)({ storage });
router.post('/init', async (req, res) => {
    try {
        const { filename, totalSize } = req.body;
        if (!filename || !totalSize) {
            return res.status(400).json({ error: 'filename and totalSize are required' });
        }
        const uploadId = await (0, uploadService_1.initializeUpload)(filename, totalSize);
        res.status(200).json({ uploadId });
    }
    catch (error) {
        console.error('Error in /init:', error);
        res.status(500).json({ error: error.message });
    }
});
router.post('/chunk', upload.single('chunk'), async (req, res) => {
    try {
        const { uploadId, chunkIndex } = req.body;
        const file = req.file;
        if (!uploadId || chunkIndex === undefined || !file) {
            return res.status(400).json({ error: 'uploadId, chunkIndex, and chunk file are required' });
        }
        await (0, uploadService_1.receiveChunk)(uploadId, parseInt(chunkIndex, 10), file.buffer);
        res.status(200).json({ success: true, message: `Chunk ${chunkIndex} received` });
    }
    catch (error) {
        console.error(`Error in /chunk for index ${req.body.chunkIndex}:`, error);
        res.status(500).json({ error: error.message });
    }
});
router.post('/complete', async (req, res) => {
    try {
        const { uploadId, totalChunks } = req.body;
        if (!uploadId || totalChunks === undefined) {
            return res.status(400).json({ error: 'uploadId and totalChunks are required' });
        }
        const finalPath = await (0, uploadService_1.completeUpload)(uploadId, parseInt(totalChunks, 10));
        res.status(200).json({ success: true, finalPath });
    }
    catch (error) {
        console.error('Error in /complete:', error);
        res.status(500).json({ error: error.message });
    }
});
exports.default = router;
//# sourceMappingURL=upload.js.map