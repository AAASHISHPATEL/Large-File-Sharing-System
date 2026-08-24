"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.connectRedis = void 0;
const redis_1 = require("redis");
const redisClient = (0, redis_1.createClient)({
    url: process.env.REDIS_URL || 'redis://localhost:6379'
});
redisClient.on('error', (err) => console.error('Redis Client Error', err));
let isConnected = false;
const connectRedis = async () => {
    if (!isConnected) {
        await redisClient.connect();
        isConnected = true;
        console.log('Connected to Redis');
    }
};
exports.connectRedis = connectRedis;
exports.default = redisClient;
