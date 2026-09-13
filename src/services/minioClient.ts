import { Client } from 'minio';
import fs from 'fs';
import path from 'path';
import { Readable } from 'stream';

const minioClient = new Client({
    endPoint: process.env.MINIO_ENDPOINT || 'localhost',
    port: parseInt(process.env.MINIO_PORT || '9000', 10),
    useSSL: process.env.MINIO_USE_SSL === 'true',
    accessKey: process.env.MINIO_ACCESS_KEY || 'minioadmin',
    secretKey: process.env.MINIO_SECRET_KEY || 'minioadminpassword'
});

const BUCKET_NAME = process.env.MINIO_BUCKET || 'filesharing';

export const initializeMinio = async () => {
    try {
        const exists = await minioClient.bucketExists(BUCKET_NAME);
        if (!exists) {
            await minioClient.makeBucket(BUCKET_NAME, 'us-east-1');
            console.log(`Bucket ${BUCKET_NAME} created successfully`);
        } else {
            console.log(`Bucket ${BUCKET_NAME} already exists`);
        }
    } catch (err: any) {
        if (err.code === 'BucketAlreadyOwnedByYou' || err.code === 'BucketAlreadyExists') {
            console.log(`Bucket ${BUCKET_NAME} already exists (handled concurrent creation)`);
            return;
        }
        console.error('Error initializing MinIO:', err);
        throw err;
    }
};

export const uploadToMinio = async (objectName: string, filePath: string) => {
    try {
        const metaData = {
            'Content-Type': 'application/octet-stream',
        };
        await minioClient.fPutObject(BUCKET_NAME, objectName, filePath, metaData);
        return `${BUCKET_NAME}/${objectName}`;
    } catch (err) {
        console.error('Error uploading to MinIO:', err);
        throw err;
    }
};

export const streamFromMinio = async (objectPath: string): Promise<{ stream: Readable; size: number }> => {
    const objectName = objectPath.replace(`${BUCKET_NAME}/`, '');
    const stat = await minioClient.statObject(BUCKET_NAME, objectName);
    const stream = await minioClient.getObject(BUCKET_NAME, objectName) as unknown as Readable;
    return { stream, size: stat.size };
};

export const getPresignedUrl = async (objectPath: string, expirySeconds = 3600): Promise<string> => {
    const objectName = objectPath.replace(`${BUCKET_NAME}/`, '');
    return minioClient.presignedGetObject(BUCKET_NAME, objectName, expirySeconds);
};

export default minioClient;
