import { Router, Response, Request } from 'express';
import multer from 'multer';
import { initializeUpload, receiveChunk, completeUpload } from '../services/uploadService';
import { authenticateJWT, AuthRequest } from '../middleware/authMiddleware';
import redisClient from '../services/redisClient';

const router = Router();
const storage = multer.memoryStorage();
const upload = multer({ storage });

router.get('/status/:uploadId', authenticateJWT, async (req: AuthRequest, res: Response) => {
    try {
        const { uploadId } = req.params;
        const metadata = await redisClient.hGetAll(`upload:${uploadId}`);
        
        if (!metadata || !metadata.userId) {
            return res.status(404).json({ error: 'Upload session not found' });
        }
        
        if (metadata.userId !== req.user!.id) {
            return res.status(403).json({ error: 'Unauthorized' });
        }

        const receivedChunks = await redisClient.sMembers(`upload:${uploadId}:chunks`);
        const receivedChunksInt = receivedChunks.map(c => parseInt(c, 10)).sort((a, b) => a - b);
        
        res.status(200).json({ 
            uploadId, 
            totalSize: metadata.totalSize,
            receivedChunks: receivedChunksInt 
        });
    } catch (error: any) {
        console.error('Error in /status:', error);
        res.status(500).json({ error: error.message });
    }
});

router.post('/init', authenticateJWT, async (req: AuthRequest, res: Response) => {
    try {
        const { filename, totalSize } = req.body;
        if (!filename || !totalSize) {
            return res.status(400).json({ error: 'filename and totalSize are required' });
        }
        
        const uploadId = await initializeUpload(filename, totalSize, req.user!.id);
        res.status(200).json({ uploadId });
    } catch (error: any) {
        console.error('Error in /init:', error);
        res.status(500).json({ error: error.message });
    }
});

router.post('/chunk', authenticateJWT, upload.single('chunk'), async (req: AuthRequest, res: Response) => {
    try {
        const { uploadId, chunkIndex } = req.body;
        const file = req.file;

        if (!uploadId || chunkIndex === undefined || !file) {
            return res.status(400).json({ error: 'uploadId, chunkIndex, and chunk file are required' });
        }

        await receiveChunk(uploadId, parseInt(chunkIndex, 10), file.buffer, req.user!.id);
        res.status(200).json({ success: true, message: `Chunk ${chunkIndex} received` });
    } catch (error: any) {
        console.error(`Error in /chunk for index ${req.body.chunkIndex}:`, error);
        res.status(500).json({ error: error.message });
    }
});

router.post('/complete', authenticateJWT, async (req: AuthRequest, res: Response) => {
    try {
        const { uploadId, totalChunks } = req.body;
        
        if (!uploadId || totalChunks === undefined) {
            return res.status(400).json({ error: 'uploadId and totalChunks are required' });
        }

        const finalPath = await completeUpload(uploadId, parseInt(totalChunks, 10), req.user!.id);
        res.status(200).json({ success: true, finalPath });
    } catch (error: any) {
        console.error('Error in /complete:', error);
        res.status(500).json({ error: error.message });
    }
});

export default router;
