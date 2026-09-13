import { Router, Response } from 'express';
import multer from 'multer';
import { initializeUpload, receiveChunk, completeUpload } from '../services/uploadService';
import { authenticateJWT, AuthRequest } from '../middleware/authMiddleware';
import { slidingWindowRateLimiter } from '../middleware/rateLimiter';
import redisClient from '../services/redisClient';
import pool from '../config/db';
import { streamFromMinio, getPresignedUrl } from '../services/minioClient';
import { getIO } from '../services/websocket';
import { publishStitchJob } from '../services/rabbitmq';

const router = Router();
const storage = multer.memoryStorage();
const upload = multer({ storage });

// Rate limits
const chunkLimiter = slidingWindowRateLimiter(600, 60000, 'chunk'); // 600 chunks per minute per user
const initLimiter = slidingWindowRateLimiter(30, 60000, 'init'); // 30 inits per minute per user

// ─── Existing routes ────────────────────────────────────────────

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
        res.status(500).json({ error: error.message });
    }
});

router.post('/init', authenticateJWT, initLimiter, async (req: AuthRequest, res: Response) => {
    try {
        const { filename, totalSize } = req.body;
        if (!filename || !totalSize) {
            return res.status(400).json({ error: 'filename and totalSize are required' });
        }
        const uploadId = await initializeUpload(filename, totalSize, req.user!.id);
        res.status(200).json({ uploadId });
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

router.post('/chunk', authenticateJWT, chunkLimiter, upload.single('chunk'), async (req: AuthRequest, res: Response) => {
    try {
        const { uploadId, chunkIndex } = req.body;
        const file = req.file;

        if (!uploadId || chunkIndex === undefined || !file) {
            return res.status(400).json({ error: 'uploadId, chunkIndex, and chunk file are required' });
        }

        await receiveChunk(uploadId, parseInt(chunkIndex, 10), file.buffer, req.user!.id);
        res.status(200).json({ success: true, message: `Chunk ${chunkIndex} received` });
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

router.post('/complete', authenticateJWT, async (req: AuthRequest, res: Response) => {
    try {
        const { uploadId, totalChunks } = req.body;
        if (!uploadId || totalChunks === undefined) {
            return res.status(400).json({ error: 'uploadId and totalChunks are required' });
        }
        
        const metadata = await redisClient.hGetAll(`upload:${uploadId}`);
        if (!metadata || metadata.userId !== req.user!.id) {
            return res.status(403).json({ error: 'Unauthorized or invalid upload session' });
        }

        const receivedChunksCount = await redisClient.sCard(`upload:${uploadId}:chunks`);
        if (receivedChunksCount !== parseInt(totalChunks, 10)) {
            return res.status(400).json({ error: `Missing chunks. Expected ${totalChunks}, got ${receivedChunksCount}` });
        }

        // Update DB Status
        await pool.query(
            "UPDATE files SET status = 'QUEUED' WHERE id = $1",
            [uploadId]
        );

        // Queue to RabbitMQ
        await publishStitchJob({
            uploadId,
            totalChunks: parseInt(totalChunks, 10),
            userId: req.user!.id
        });

        res.status(202).json({ 
            success: true, 
            status: 'QUEUED',
            message: 'File queued for background processing' 
        });
    } catch (error: any) {
        console.error('Error queuing upload:', error);
        res.status(500).json({ error: error.message });
    }
});

// ─── New: List user's files ──────────────────────────────────────

router.get('/files', authenticateJWT, async (req: AuthRequest, res: Response) => {
    try {
        const userId = req.user!.id;
        const cacheKey = `cache:files:${userId}`;
        
        // 1. Check Cache
        const cachedFiles = await redisClient.get(cacheKey);
        if (cachedFiles) {
            return res.json({ files: JSON.parse(cachedFiles), source: 'cache' });
        }

        // 2. Cache Miss -> Query Database
        const result = await pool.query(
            `SELECT f.id, f.filename, f.total_size, f.s3_path, f.status, f.created_at, a.permission_type
             FROM files f
             JOIN file_acls a ON f.id = a.file_id
             WHERE a.user_id = $1
             ORDER BY f.created_at DESC`,
            [userId]
        );
        
        // 3. Set Cache (TTL 60s)
        await redisClient.setEx(cacheKey, 60, JSON.stringify(result.rows));
        
        res.json({ files: result.rows, source: 'db' });
    } catch (err: any) {
        res.status(500).json({ error: err.message });
    }
});

// ─── New: Stream download from MinIO ────────────────────────────

router.get('/download/:fileId', authenticateJWT, async (req: AuthRequest, res: Response) => {
    try {
        const { fileId } = req.params;

        // Verify access
        const acl = await pool.query(
            'SELECT * FROM file_acls WHERE file_id = $1 AND user_id = $2',
            [fileId, req.user!.id]
        );
        if (!acl.rows.length) return res.status(403).json({ error: 'Access denied' });

        const fileResult = await pool.query(
            "SELECT * FROM files WHERE id = $1 AND status = 'COMPLETED'",
            [fileId]
        );
        const file = fileResult.rows[0];
        if (!file || !file.s3_path) {
            return res.status(404).json({ error: 'File not found or upload not complete' });
        }

        const { stream, size } = await streamFromMinio(file.s3_path);

        res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(file.filename)}"`);
        res.setHeader('Content-Type', 'application/octet-stream');
        res.setHeader('Content-Length', size.toString());
        res.setHeader('Access-Control-Expose-Headers', 'Content-Disposition');

        stream.pipe(res);
    } catch (err: any) {
        console.error('Download error:', err);
        res.status(500).json({ error: err.message });
    }
});

// ─── New: Presigned URL (for large file direct download) ─────────

router.get('/presign/:fileId', authenticateJWT, async (req: AuthRequest, res: Response) => {
    try {
        const { fileId } = req.params;

        const acl = await pool.query(
            'SELECT * FROM file_acls WHERE file_id = $1 AND user_id = $2',
            [fileId, req.user!.id]
        );
        if (!acl.rows.length) return res.status(403).json({ error: 'Access denied' });

        const fileResult = await pool.query(
            "SELECT * FROM files WHERE id = $1 AND status = 'COMPLETED'",
            [fileId]
        );
        const file = fileResult.rows[0];
        if (!file || !file.s3_path) {
            return res.status(404).json({ error: 'File not found or upload not complete' });
        }

        const url = await getPresignedUrl(file.s3_path, 3600); // 1 hour
        res.json({ url, filename: file.filename, size: file.total_size });
    } catch (err: any) {
        res.status(500).json({ error: err.message });
    }
});

// ─── New: Cloud share with another user ─────────────────────────

router.post('/share/:fileId', authenticateJWT, async (req: AuthRequest, res: Response) => {
    try {
        const { fileId } = req.params;
        const { toUsername } = req.body;

        if (!toUsername) return res.status(400).json({ error: 'toUsername is required' });

        // Must be owner
        const ownerCheck = await pool.query(
            "SELECT * FROM file_acls WHERE file_id = $1 AND user_id = $2 AND permission_type = 'OWNER'",
            [fileId, req.user!.id]
        );
        if (!ownerCheck.rows.length) {
            return res.status(403).json({ error: 'Only the file owner can share' });
        }

        // Find target user
        const userResult = await pool.query(
            'SELECT id, username FROM users WHERE username = $1',
            [toUsername]
        );
        if (!userResult.rows.length) {
            return res.status(404).json({ error: `User "${toUsername}" not found` });
        }
        const targetUser = userResult.rows[0];

        if (targetUser.id === req.user!.id) {
            return res.status(400).json({ error: 'Cannot share with yourself' });
        }

        // Add READ permission (ignore if already exists)
        await pool.query(
            `INSERT INTO file_acls (file_id, user_id, permission_type)
             VALUES ($1, $2, 'READ')
             ON CONFLICT (file_id, user_id) DO NOTHING`,
            [fileId, targetUser.id]
        );

        // Get file info for notification
        const fileResult = await pool.query('SELECT * FROM files WHERE id = $1', [fileId]);
        const file = fileResult.rows[0];

        // Notify the target user via WebSocket (if online)
        try {
            const io = getIO();
            io.to(`user:${targetUser.id}`).emit('file:shared', {
                fromUsername: req.user!.username,
                fileId,
                filename: file.filename,
                size: file.total_size
            });
        } catch (_) { /* socket may not be initialized yet */ }

        res.json({ success: true, message: `File shared with ${toUsername}` });
    } catch (err: any) {
        res.status(500).json({ error: err.message });
    }
});

export default router;
