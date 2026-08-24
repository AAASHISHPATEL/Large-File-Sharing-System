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
const UPLOADS_DIR = path_1.default.join(__dirname, '../../uploads');
const FINAL_DIR = path_1.default.join(UPLOADS_DIR, 'final');
const initializeUpload = async (filename, totalSize) => {
    const uploadId = (0, uuid_1.v4)();
    const tempDir = path_1.default.join(UPLOADS_DIR, uploadId);
    // Create temporary directory for chunks
    if (!fs_1.default.existsSync(tempDir)) {
        fs_1.default.mkdirSync(tempDir, { recursive: true });
    }
    // Save metadata in Redis
    await redisClient_1.default.hSet(`upload:${uploadId}`, {
        filename,
        totalSize: totalSize.toString(),
        createdAt: Date.now().toString()
    });
    return uploadId;
};
exports.initializeUpload = initializeUpload;
const receiveChunk = async (uploadId, chunkIndex, buffer) => {
    // Verify upload exists
    const exists = await redisClient_1.default.exists(`upload:${uploadId}`);
    if (!exists) {
        throw new Error('Invalid or expired upload session');
    }
    const tempDir = path_1.default.join(UPLOADS_DIR, uploadId);
    if (!fs_1.default.existsSync(tempDir)) {
        throw new Error('Temporary upload directory missing');
    }
    const chunkPath = path_1.default.join(tempDir, chunkIndex.toString());
    // Write chunk buffer to disk
    await fs_1.default.promises.writeFile(chunkPath, buffer);
    // Track received chunk in Redis Set
    await redisClient_1.default.sAdd(`upload:${uploadId}:chunks`, chunkIndex.toString());
};
exports.receiveChunk = receiveChunk;
const completeUpload = async (uploadId, totalChunks) => {
    // 1. Verify all chunks are received
    const receivedChunksCount = await redisClient_1.default.scard(`upload:${uploadId}:chunks`);
    if (receivedChunksCount !== totalChunks) {
        throw new Error(`Missing chunks. Expected ${totalChunks}, got ${receivedChunksCount}`);
    }
    const metadata = await redisClient_1.default.hGetAll(`upload:${uploadId}`);
    if (!metadata || !metadata.filename) {
        throw new Error('Upload metadata not found');
    }
    const filename = metadata.filename;
    // To prevent overwriting and ensure uniqueness, append uploadId to filename
    const finalFilename = `${uploadId}-${filename}`;
    const finalPath = path_1.default.join(FINAL_DIR, finalFilename);
    const tempDir = path_1.default.join(UPLOADS_DIR, uploadId);
    // 2. Stitch chunks together
    const writeStream = fs_1.default.createWriteStream(finalPath);
    for (let i = 0; i < totalChunks; i++) {
        const chunkPath = path_1.default.join(tempDir, i.toString());
        if (!fs_1.default.existsSync(chunkPath)) {
            writeStream.end();
            throw new Error(`Chunk ${i} is missing on disk`);
        }
        const readStream = fs_1.default.createReadStream(chunkPath);
        // Using pipeline to properly handle backpressure and stream completion
        await (0, promises_1.pipeline)(readStream, writeStream, { end: false });
    }
    // Close the final write stream
    writeStream.end();
    // 3. Cleanup temp directory and Redis keys
    await fs_1.default.promises.rm(tempDir, { recursive: true, force: true });
    await redisClient_1.default.del(`upload:${uploadId}`);
    await redisClient_1.default.del(`upload:${uploadId}:chunks`);
    return finalPath;
};
exports.completeUpload = completeUpload;
//# sourceMappingURL=uploadService.js.map