"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getIO = exports.initializeWebSocket = void 0;
const socket_io_1 = require("socket.io");
const redis_adapter_1 = require("@socket.io/redis-adapter");
const redisClient_1 = __importDefault(require("./redisClient"));
let io;
const initializeWebSocket = async (server) => {
    io = new socket_io_1.Server(server, {
        cors: {
            origin: '*',
            methods: ['GET', 'POST']
        }
    });
    // Create a duplicate redis client for publishing (adapter requires pub/sub clients)
    const pubClient = redisClient_1.default.duplicate();
    const subClient = redisClient_1.default.duplicate();
    await Promise.all([pubClient.connect(), subClient.connect()]);
    io.adapter((0, redis_adapter_1.createAdapter)(pubClient, subClient));
    io.on('connection', (socket) => {
        console.log(`Socket connected: ${socket.id}`);
        // Client can join a room specific to an uploadId
        socket.on('joinUploadRoom', (uploadId) => {
            socket.join(uploadId);
            console.log(`Socket ${socket.id} joined room ${uploadId}`);
        });
        socket.on('disconnect', () => {
            console.log(`Socket disconnected: ${socket.id}`);
        });
    });
    console.log('WebSocket server initialized with Redis adapter');
};
exports.initializeWebSocket = initializeWebSocket;
const getIO = () => {
    if (!io) {
        throw new Error('Socket.io not initialized');
    }
    return io;
};
exports.getIO = getIO;
