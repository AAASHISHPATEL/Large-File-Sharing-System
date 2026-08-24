import { Client } from 'minio';
import fs from 'fs';
import path from 'path';

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
    } catch (err) {
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

export default minioClient;
