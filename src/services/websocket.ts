import { Server } from 'socket.io';
import { createAdapter } from '@socket.io/redis-adapter';
import redisClient from './redisClient';
import { Server as HttpServer } from 'http';

let io: Server;

export const initializeWebSocket = async (server: HttpServer) => {
    io = new Server(server, {
        cors: {
            origin: '*',
            methods: ['GET', 'POST']
        }
    });

    // Create a duplicate redis client for publishing (adapter requires pub/sub clients)
    const pubClient = redisClient.duplicate();
    const subClient = redisClient.duplicate();

    await Promise.all([pubClient.connect(), subClient.connect()]);

    io.adapter(createAdapter(pubClient, subClient));

    io.on('connection', (socket) => {
        console.log(`Socket connected: ${socket.id}`);

        // Client can join a room specific to an uploadId
        socket.on('joinUploadRoom', (uploadId: string) => {
            socket.join(uploadId);
            console.log(`Socket ${socket.id} joined room ${uploadId}`);
        });

        socket.on('disconnect', () => {
            console.log(`Socket disconnected: ${socket.id}`);
        });
    });

    console.log('WebSocket server initialized with Redis adapter');
};

export const getIO = () => {
    if (!io) {
        throw new Error('Socket.io not initialized');
    }
    return io;
};
