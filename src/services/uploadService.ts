import { v4 as uuidv4 } from 'uuid';
import path from 'path';
import fs from 'fs';
import { pipeline } from 'stream/promises';
import redisClient from './redisClient';
import pool from '../config/db';
import { getIO } from './websocket';

const UPLOADS_DIR = path.join(__dirname, '../../uploads');
const FINAL_DIR = path.join(UPLOADS_DIR, 'final');

export const initializeUpload = async (filename: string, totalSize: number, userId: string): Promise<string> => {
    const uploadId = uuidv4();
    const tempDir = path.join(UPLOADS_DIR, uploadId);

    if (!fs.existsSync(tempDir)) {
        fs.mkdirSync(tempDir, { recursive: true });
    }

    await redisClient.hSet(`upload:${uploadId}`, {
        filename,
        totalSize: totalSize.toString(),
        userId,
        createdAt: Date.now().toString()
    });

    await pool.query(
        'INSERT INTO files (id, filename, total_size, status) VALUES ($1, $2, $3, $4)',
        [uploadId, filename, totalSize, 'UPLOADING']
    );

    await pool.query(
        'INSERT INTO file_acls (file_id, user_id, permission_type) VALUES ($1, $2, $3)',
        [uploadId, userId, 'OWNER']
    );

    return uploadId;
};

export const receiveChunk = async (uploadId: string, chunkIndex: number, buffer: Buffer, userId: string): Promise<void> => {
    const startTime = Date.now();
    const metadata = await redisClient.hGetAll(`upload:${uploadId}`);
    if (!metadata || !metadata.userId) {
        throw new Error('Invalid or expired upload session');
    }

    if (metadata.userId !== userId) {
        throw new Error('Unauthorized: You do not own this upload session');
    }

    const tempDir = path.join(UPLOADS_DIR, uploadId);
    if (!fs.existsSync(tempDir)) {
        throw new Error('Temporary upload directory missing');
    }

    const chunkPath = path.join(tempDir, chunkIndex.toString());
    
    await fs.promises.writeFile(chunkPath, buffer);
    await redisClient.sAdd(`upload:${uploadId}:chunks`, chunkIndex.toString());

    const duration = Date.now() - startTime;
    // Emit progress to the specific room
    const io = getIO();
    io.to(uploadId).emit('progress', {
        event: 'CHUNK_WRITTEN',
        uploadId,
        chunkIndex,
        processingTimeMs: duration
    });
};

export const completeUpload = async (uploadId: string, totalChunks: number, userId: string): Promise<string> => {
    const io = getIO();
    io.to(uploadId).emit('progress', { event: 'STITCHING_STARTED', uploadId });

    const receivedChunksCount = await redisClient.sCard(`upload:${uploadId}:chunks`);
    if (receivedChunksCount !== totalChunks) {
        throw new Error(`Missing chunks. Expected ${totalChunks}, got ${receivedChunksCount}`);
    }

    const metadata = await redisClient.hGetAll(`upload:${uploadId}`);
    if (!metadata || !metadata.filename) {
        throw new Error('Upload metadata not found');
    }

    if (metadata.userId !== userId) {
        throw new Error('Unauthorized: You do not own this upload session');
    }

    const filename = metadata.filename;
    const finalFilename = `${uploadId}-${filename}`;
    const finalPath = path.join(FINAL_DIR, finalFilename);
    const tempDir = path.join(UPLOADS_DIR, uploadId);

    const writeStream = fs.createWriteStream(finalPath);

    for (let i = 0; i < totalChunks; i++) {
        const chunkPath = path.join(tempDir, i.toString());
        if (!fs.existsSync(chunkPath)) {
            writeStream.end();
            throw new Error(`Chunk ${i} is missing on disk`);
        }
        const readStream = fs.createReadStream(chunkPath);
        await pipeline(readStream, writeStream, { end: false });
    }

    writeStream.end();

    io.to(uploadId).emit('progress', { event: 'UPLOADING_TO_MINIO', uploadId });
    const { uploadToMinio } = require('./minioClient'); 
    const minioPath = await uploadToMinio(finalFilename, finalPath);

    await pool.query(
        'UPDATE files SET status = $1, s3_path = $2 WHERE id = $3',
        ['COMPLETED', minioPath, uploadId]
    );

    await fs.promises.rm(tempDir, { recursive: true, force: true });
    await fs.promises.unlink(finalPath);
    await redisClient.del(`upload:${uploadId}`);
    await redisClient.del(`upload:${uploadId}:chunks`);

    io.to(uploadId).emit('progress', { event: 'UPLOAD_COMPLETE', uploadId, minioPath });

    return minioPath;
};
