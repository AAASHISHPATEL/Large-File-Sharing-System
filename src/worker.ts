import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import { pipeline } from 'stream/promises';
import amqp, { Connection, Channel, ConsumeMessage } from 'amqplib';
import { connectRedis } from './services/redisClient';
import redisClient from './services/redisClient';
import pool, { initializeDB } from './config/db';
import { initializeMinio } from './services/minioClient';
import { StitchJobData } from './services/rabbitmq';

const QUEUE_NAME = 'file_stitch_queue';
const UPLOADS_DIR = path.join(__dirname, '../uploads');
const FINAL_DIR = path.join(UPLOADS_DIR, 'final');

let channel: Channel;

// Create required directories
if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });
if (!fs.existsSync(FINAL_DIR)) fs.mkdirSync(FINAL_DIR, { recursive: true });

async function processJob(msg: ConsumeMessage) {
    const job: StitchJobData = JSON.parse(msg.content.toString());
    const { uploadId, totalChunks, userId } = job;

    console.log(`[Worker] Started processing job for uploadId: ${uploadId}`);
    
    // Emit STITCHING_STARTED via Redis Pub/Sub (Socket.io will broadcast this)
    await redisClient.publish('worker_events', JSON.stringify({
        event: 'STITCHING_STARTED',
        uploadId
    }));

    try {
        const metadata = await redisClient.hGetAll(`upload:${uploadId}`);
        if (!metadata || !metadata.filename) {
            throw new Error('Upload metadata not found in Redis');
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
        console.log(`[Worker] Finished stitching for uploadId: ${uploadId}`);

        // Emit UPLOADING_TO_MINIO
        await redisClient.publish('worker_events', JSON.stringify({
            event: 'UPLOADING_TO_MINIO',
            uploadId
        }));

        const { uploadToMinio } = require('./services/minioClient');
        const minioPath = await uploadToMinio(finalFilename, finalPath);

        // Update DB
        await pool.query(
            'UPDATE files SET status = $1, s3_path = $2 WHERE id = $3',
            ['COMPLETED', minioPath, uploadId]
        );

        // Cleanup
        await fs.promises.rm(tempDir, { recursive: true, force: true });
        await fs.promises.unlink(finalPath);
        await redisClient.del(`upload:${uploadId}`);
        await redisClient.del(`upload:${uploadId}:chunks`);

        // Invalidate user files cache
        await redisClient.del(`cache:files:${userId}`);

        // Emit UPLOAD_COMPLETE
        await redisClient.publish('worker_events', JSON.stringify({
            event: 'UPLOAD_COMPLETE',
            uploadId,
            minioPath
        }));

        console.log(`[Worker] Job completed successfully for uploadId: ${uploadId}`);
        channel.ack(msg);

    } catch (error: any) {
        console.error(`[Worker] Job failed for uploadId: ${uploadId}`, error);
        
        await redisClient.publish('worker_events', JSON.stringify({
            event: 'PROCESSING_FAILED',
            uploadId,
            error: error.message
        }));

        // Reject the message. If it has been redelivered, send to DLQ (requeue: false)
        channel.nack(msg, false, !msg.fields.redelivered);
    }
}

async function startWorker() {
    console.log('[Worker] Initializing worker service...');
    try {
        await connectRedis();
        await initializeDB();
        await initializeMinio();

        const rabbitMqUrl = process.env.RABBITMQ_URL || 'amqp://guest:guest@localhost:5672';
        const connection = await amqp.connect(rabbitMqUrl);
        channel = await connection.createChannel();
        
        // Ensure queue exists (producer usually asserts it, but good practice here too)
        await channel.assertQueue(QUEUE_NAME, {
            durable: true,
            arguments: {
                'x-dead-letter-exchange': 'file_exchange',
                'x-dead-letter-routing-key': 'dlq'
            }
        });

        // Fair dispatch
        await channel.prefetch(1);

        console.log(`[Worker] Connected to RabbitMQ. Waiting for messages in ${QUEUE_NAME}...`);
        channel.consume(QUEUE_NAME, async (msg) => {
            if (msg) {
                await processJob(msg);
            }
        }, { noAck: false });

    } catch (error) {
        console.error('[Worker] Failed to start:', error);
        process.exit(1);
    }
}

startWorker();
