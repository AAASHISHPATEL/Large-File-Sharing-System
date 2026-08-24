import { createClient } from 'redis';

const redisClient = createClient({
    url: process.env.REDIS_URL || 'redis://localhost:6379',
    // Disable HELLO handshake to support older Redis versions (< 6)
    socket: {
        reconnectStrategy: (retries) => Math.min(retries * 50, 2000)
    },
    RESP: 2 as any
});

redisClient.on('error', (err) => console.error('Redis Client Error', err));

let isConnected = false;

export const connectRedis = async () => {
    if (!isConnected) {
        await redisClient.connect();
        isConnected = true;
        console.log('Connected to Redis');
    }
};

export default redisClient;
