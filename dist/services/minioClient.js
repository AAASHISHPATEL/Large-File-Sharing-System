"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.uploadToMinio = exports.initializeMinio = void 0;
const minio_1 = require("minio");
const minioClient = new minio_1.Client({
    endPoint: process.env.MINIO_ENDPOINT || 'localhost',
    port: parseInt(process.env.MINIO_PORT || '9000', 10),
    useSSL: process.env.MINIO_USE_SSL === 'true',
    accessKey: process.env.MINIO_ACCESS_KEY || 'minioadmin',
    secretKey: process.env.MINIO_SECRET_KEY || 'minioadminpassword'
});
const BUCKET_NAME = process.env.MINIO_BUCKET || 'filesharing';
const initializeMinio = async () => {
    try {
        const exists = await minioClient.bucketExists(BUCKET_NAME);
        if (!exists) {
            await minioClient.makeBucket(BUCKET_NAME, 'us-east-1');
            console.log(`Bucket ${BUCKET_NAME} created successfully`);
        }
        else {
            console.log(`Bucket ${BUCKET_NAME} already exists`);
        }
    }
    catch (err) {
        console.error('Error initializing MinIO:', err);
        throw err;
    }
};
exports.initializeMinio = initializeMinio;
const uploadToMinio = async (objectName, filePath) => {
    try {
        const metaData = {
            'Content-Type': 'application/octet-stream',
        };
        await minioClient.fPutObject(BUCKET_NAME, objectName, filePath, metaData);
        return `${BUCKET_NAME}/${objectName}`;
    }
    catch (err) {
        console.error('Error uploading to MinIO:', err);
        throw err;
    }
};
exports.uploadToMinio = uploadToMinio;
exports.default = minioClient;
