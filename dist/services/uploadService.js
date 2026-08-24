"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.completeUpload = exports.receiveChunk = exports.initializeUpload = void 0;
const uuid_1 = require("uuid");
const path_1 = __importDefault(require("path"));
const fs_1 = __importDefault(require("fs"));
const promises_1 = require("stream/promises");
const redisClient_1 = __importDefault(require("./redisClient"));
const db_1 = __importDefault(require("../config/db"));
const websocket_1 = require("./websocket");
const UPLOADS_DIR = path_1.default.join(__dirname, '../../uploads');
const FINAL_DIR = path_1.default.join(UPLOADS_DIR, 'final');
const initializeUpload = async (filename, totalSize, userId) => {
    const uploadId = (0, uuid_1.v4)();
    const tempDir = path_1.default.join(UPLOADS_DIR, uploadId);
    if (!fs_1.default.existsSync(tempDir)) {
        fs_1.default.mkdirSync(tempDir, { recursive: true });
    }
    await redisClient_1.default.hSet(`upload:${uploadId}`, {
        filename,
        totalSize: totalSize.toString(),
        userId,
        createdAt: Date.now().toString()
    });
    await db_1.default.query('INSERT INTO files (id, filename, total_size, status) VALUES ($1, $2, $3, $4)', [uploadId, filename, totalSize, 'UPLOADING']);
    await db_1.default.query('INSERT INTO file_acls (file_id, user_id, permission_type) VALUES ($1, $2, $3)', [uploadId, userId, 'OWNER']);
    return uploadId;
};
exports.initializeUpload = initializeUpload;
const receiveChunk = async (uploadId, chunkIndex, buffer, userId) => {
    const startTime = Date.now();
    const metadata = await redisClient_1.default.hGetAll(`upload:${uploadId}`);
    if (!metadata || !metadata.userId) {
        throw new Error('Invalid or expired upload session');
    }
    if (metadata.userId !== userId) {
        throw new Error('Unauthorized: You do not own this upload session');
    }
    const tempDir = path_1.default.join(UPLOADS_DIR, uploadId);
    if (!fs_1.default.existsSync(tempDir)) {
        throw new Error('Temporary upload directory missing');
    }
    const chunkPath = path_1.default.join(tempDir, chunkIndex.toString());
    await fs_1.default.promises.writeFile(chunkPath, buffer);
    await redisClient_1.default.sAdd(`upload:${uploadId}:chunks`, chunkIndex.toString());
    const duration = Date.now() - startTime;
    // Emit progress to the specific room
    const io = (0, websocket_1.getIO)();
    io.to(uploadId).emit('progress', {
        event: 'CHUNK_WRITTEN',
        uploadId,
        chunkIndex,
        processingTimeMs: duration
    });
};
exports.receiveChunk = receiveChunk;
const completeUpload = async (uploadId, totalChunks, userId) => {
    const io = (0, websocket_1.getIO)();
    io.to(uploadId).emit('progress', { event: 'STITCHING_STARTED', uploadId });
    const receivedChunksCount = await redisClient_1.default.sCard(`upload:${uploadId}:chunks`);
    if (receivedChunksCount !== totalChunks) {
        throw new Error(`Missing chunks. Expected ${totalChunks}, got ${receivedChunksCount}`);
    }
    const metadata = await redisClient_1.default.hGetAll(`upload:${uploadId}`);
    if (!metadata || !metadata.filename) {
        throw new Error('Upload metadata not found');
    }
    if (metadata.userId !== userId) {
        throw new Error('Unauthorized: You do not own this upload session');
    }
    const filename = metadata.filename;
    const finalFilename = `${uploadId}-${filename}`;
    const finalPath = path_1.default.join(FINAL_DIR, finalFilename);
    const tempDir = path_1.default.join(UPLOADS_DIR, uploadId);
    const writeStream = fs_1.default.createWriteStream(finalPath);
    for (let i = 0; i < totalChunks; i++) {
        const chunkPath = path_1.default.join(tempDir, i.toString());
        if (!fs_1.default.existsSync(chunkPath)) {
            writeStream.end();
            throw new Error(`Chunk ${i} is missing on disk`);
        }
        const readStream = fs_1.default.createReadStream(chunkPath);
        await (0, promises_1.pipeline)(readStream, writeStream, { end: false });
    }
    writeStream.end();
    io.to(uploadId).emit('progress', { event: 'UPLOADING_TO_MINIO', uploadId });
    const { uploadToMinio } = require('./minioClient');
    const minioPath = await uploadToMinio(finalFilename, finalPath);
    await db_1.default.query('UPDATE files SET status = $1, s3_path = $2 WHERE id = $3', ['COMPLETED', minioPath, uploadId]);
    await fs_1.default.promises.rm(tempDir, { recursive: true, force: true });
    await fs_1.default.promises.unlink(finalPath);
    await redisClient_1.default.del(`upload:${uploadId}`);
    await redisClient_1.default.del(`upload:${uploadId}:chunks`);
    io.to(uploadId).emit('progress', { event: 'UPLOAD_COMPLETE', uploadId, minioPath });
    return minioPath;
};
exports.completeUpload = completeUpload;
