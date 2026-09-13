import { Server } from 'socket.io';
import { createAdapter } from '@socket.io/redis-adapter';
import redisClient from './redisClient';
import { Server as HttpServer } from 'http';

let io: Server;

// username -> socketId (in-memory; works for single instance)
// For multi-instance: store in Redis instead
const onlineUsers = new Map<string, string>();

export const initializeWebSocket = async (server: HttpServer) => {
    io = new Server(server, {
        cors: {
            origin: '*',
            methods: ['GET', 'POST']
        }
    });

    // Duplicate clients for Redis pub/sub adapter
    const pubClient = redisClient.duplicate();
    const subClient = redisClient.duplicate();
    await Promise.all([pubClient.connect(), subClient.connect()]);
    io.adapter(createAdapter(pubClient, subClient));

    io.on('connection', (socket) => {
        console.log(`Socket connected: ${socket.id}`);

        // ── User identification (call after login) ──────────────
        socket.on('identify', (data: { userId: string; username: string }) => {
            socket.data.userId = data.userId;
            socket.data.username = data.username;
            onlineUsers.set(data.username, socket.id);
            // Join personal room for cloud share notifications
            socket.join(`user:${data.userId}`);
            console.log(`User identified: ${data.username} (${socket.id})`);
        });

        // ── Upload room (for progress events) ───────────────────
        socket.on('joinUploadRoom', (uploadId: string) => {
            socket.join(uploadId);
            console.log(`Socket ${socket.id} joined room ${uploadId}`);
        });

        // ── P2P: Request transfer to another user ────────────────
        socket.on('p2p:request', (data: { toUsername: string; filename: string; fileSize: number }) => {
            const targetSocketId = onlineUsers.get(data.toUsername);
            if (!targetSocketId) {
                socket.emit('p2p:error', { message: `"${data.toUsername}" is not online right now` });
                return;
            }
            io.to(targetSocketId).emit('p2p:incoming-request', {
                fromUsername: socket.data.username || 'Unknown',
                fromSocketId: socket.id,
                filename: data.filename,
                fileSize: data.fileSize
            });
            socket.emit('p2p:request-sent', { toUsername: data.toUsername });
            console.log(`P2P request: ${socket.data.username} -> ${data.toUsername} (${data.filename})`);
        });

        // ── P2P: Accept ──────────────────────────────────────────
        socket.on('p2p:accept', (data: { toSocketId: string }) => {
            io.to(data.toSocketId).emit('p2p:accepted', {
                fromSocketId: socket.id,
                fromUsername: socket.data.username
            });
            console.log(`P2P accepted by ${socket.data.username}`);
        });

        // ── P2P: Reject ──────────────────────────────────────────
        socket.on('p2p:reject', (data: { toSocketId: string }) => {
            io.to(data.toSocketId).emit('p2p:rejected', {
                fromUsername: socket.data.username
            });
            console.log(`P2P rejected by ${socket.data.username}`);
        });

        // ── WebRTC Signaling Relay ───────────────────────────────
        socket.on('p2p:offer', (data: { toSocketId: string; offer: object }) => {
            io.to(data.toSocketId).emit('p2p:offer', {
                fromSocketId: socket.id,
                offer: data.offer
            });
        });

        socket.on('p2p:answer', (data: { toSocketId: string; answer: object }) => {
            io.to(data.toSocketId).emit('p2p:answer', {
                answer: data.answer
            });
        });

        socket.on('p2p:ice-candidate', (data: { toSocketId: string; candidate: object }) => {
            io.to(data.toSocketId).emit('p2p:ice-candidate', {
                candidate: data.candidate
            });
        });

        // ── Disconnect ───────────────────────────────────────────
        socket.on('disconnect', () => {
            if (socket.data.username) {
                onlineUsers.delete(socket.data.username);
                console.log(`User ${socket.data.username} went offline`);
            }
            console.log(`Socket disconnected: ${socket.id}`);
        });
    });

    // ── Subscribe to background worker events ───────────────
    const workerSubClient = redisClient.duplicate();
    await workerSubClient.connect();
    workerSubClient.subscribe('worker_events', (message) => {
        try {
            const data = JSON.parse(message);
            const { uploadId, event } = data;
            if (uploadId && event) {
                io.to(uploadId).emit('progress', data);
            }
        } catch (e) {
            console.error('Failed to parse worker_event', e);
        }
    });

    console.log('WebSocket server initialized with Redis adapter');
};

export const getIO = () => {
    if (!io) throw new Error('Socket.io not initialized');
    return io;
};
