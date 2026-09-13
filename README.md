# 📦 Large File Sharing System (Enterprise Edition)

A production-ready, highly scalable, distributed backend system for uploading, sharing, and processing large files. 

This project demonstrates advanced **System Design** concepts, including **Chunked Uploads**, **Asynchronous Processing via Message Queues**, **Sliding Window Rate Limiting**, **Write-Through Caching**, and **Load Balancing**. Built with Node.js, TypeScript, PostgreSQL, Redis, RabbitMQ, and MinIO.

---

## 🏗️ Architecture Overview

```mermaid
graph TD
    Client[Client Browser / UI] -->|HTTP / WebSockets| Nginx[Nginx Load Balancer]
    
    subgraph "API Cluster"
        Nginx -->|Round-Robin| App1[Express API Node 1]
        Nginx -->|Round-Robin| App2[Express API Node 2]
    end

    subgraph "Data & State Layer"
        App1 -.->|Read/Write| Postgres[(PostgreSQL)]
        App2 -.->|Read/Write| Postgres
        
        App1 -.->|Cache & Rate Limits| Redis[(Redis)]
        App2 -.->|Cache & Rate Limits| Redis
    end
    
    subgraph "Asynchronous Processing"
        App1 -->|Publish Job| RabbitMQ[RabbitMQ Queue]
        App2 -->|Publish Job| RabbitMQ
        
        RabbitMQ -->|Consume (Prefetch 1)| Worker[Background Worker]
        Worker -.->|Stream Chunks| MinIO[(MinIO / S3 Object Storage)]
        Worker -.->|Publish Progress| Redis
    end
    
    Redis -.->|WebSocket PubSub| App1
    Redis -.->|WebSocket PubSub| App2
```

### Advanced System Design Components

| Component | Role | Architectural Justification |
|-----------|------|-----------------------------|
| **Nginx Load Balancer** | Traffic Distribution | Horizontally scales the API by routing traffic evenly (least-conn) across multiple Express.js nodes on Port 8080. |
| **RabbitMQ** | Message Broker & Decoupling | Used to offload the heavy chunk-stitching process. By placing stitching jobs on a durable queue (`file_stitch_queue`), the API responds to clients instantly (`HTTP 202 Accepted`), avoiding event-loop blocking and scaling processing independently. |
| **Background Worker** | Heavy Computation | An isolated Node.js process that streams file chunks from disk directly into MinIO. Uses `prefetch(1)` to ensure fair task distribution if multiple workers are deployed. |
| **Redis (Rate Limiter)** | Abuse Prevention | Implements a **Sliding Window Rate Limiter** using atomic Redis Sorted Sets (`ZADD`, `ZREMRANGEBYSCORE`). This provides millisecond-perfect rolling windows, completely eliminating the "boundary burst" flaws of fixed-window algorithms. |
| **Redis (Caching)** | API Acceleration | Implements a **Write-Through Cache** for the user dashboard (`/upload/files`). Retrieves file lists in <2ms and auto-invalidates when new uploads complete. |
| **Redis (Pub/Sub)** | Real-time Sync | Synchronizes WebSocket events. When the background Worker finishes an upload, it publishes an event to Redis. The Express nodes pick it up and emit real-time WebSocket progress updates to the exact client browser! |
| **PostgreSQL** | Relational Metadata | ACID-compliant storage for user accounts, file records, and ACL (Access Control Lists). |
| **MinIO** | Object Storage | Highly available S3-compatible blob storage used to securely house the final stitched files indefinitely. |

---

## ✨ Core Features

- ✅ **Chunked & Resumable Uploads** — Break multi-gigabyte files into small 5MB chunks. If a network drops, the client queries which chunks arrived and resumes exactly where it left off.
- ✅ **Sliding Window Rate Limiting** — Strict throttling on Authentication (10req/min) and Chunk Uploads (600req/min) prevents DDoS and brute-force attacks.
- ✅ **Asynchronous Stitching** — The API never blocks. Upload completions are handed off to RabbitMQ and processed in the background.
- ✅ **Real-Time WebSocket Progress** — Users get live UI updates ("Queued", "Stitching...", "Uploading to Cloud...", "Complete") broadcasted across the cluster via Redis Pub/Sub.
- ✅ **Lightning Fast Dashboard** — Dashboard queries are cached in Redis to drastically reduce PostgreSQL load.
- ✅ **Fully Dockerized** — The entire 8-container architecture is orchestrated with a single `docker-compose.yml`.

---

## 🗂️ Project Structure

```
Large File Sharing System/
├── src/
│   ├── index.ts                  # App entry point, WebSocket init
│   ├── worker.ts                 # Dedicated RabbitMQ consumer process
│   ├── config/
│   │   └── db.ts                 # PostgreSQL pool setup
│   ├── middleware/
│   │   ├── authMiddleware.ts     # JWT verification
│   │   └── rateLimiter.ts        # Redis sliding-window algorithm
│   ├── routes/
│   │   ├── auth.ts               # Login/Register (Rate limited)
│   │   └── upload.ts             # Chunk handling, Caching, Job Enqueueing
│   └── services/
│       ├── redisClient.ts        # Redis Cache & Pub/Sub client
│       ├── minioClient.ts        # MinIO S3 operations + Bucket creation
│       ├── rabbitmq.ts           # RabbitMQ connection & publisher
│       ├── uploadService.ts      # Core file-system chunk logic
│       └── websocket.ts          # Socket.IO Redis Adapter
├── public/
│   ├── index.html                # Modern, dynamic frontend UI
│   ├── app.js                    # Frontend logic (Socket.IO, Chunking)
│   └── styles.css                # Glassmorphism UI styles
├── docker-compose.yml            # 8-Container orchestration
├── Dockerfile                    # Multi-stage Docker build
└── nginx.conf                    # Nginx Reverse Proxy config
```

---

## 🔄 Upload Flow Details

1. **Initialize (`POST /upload/init`)**: Client requests an upload session. A unique `uploadId` is generated, and rate limits are checked.
2. **Chunking (`POST /upload/chunk`)**: The client slices the file locally and uploads chunks concurrently. Chunks are saved to a shared Docker Volume (`shared_uploads`).
3. **Completion (`POST /upload/complete`)**: Client signals completion. The API publishes a `StitchJobData` payload to RabbitMQ and immediately returns a `202 Accepted` status.
4. **Background Processing**:
   - The `worker.ts` process consumes the job from RabbitMQ.
   - It streams the chunks together directly into MinIO using `fPutObject`.
   - It updates PostgreSQL to mark the file as `COMPLETED`.
   - It publishes a `worker_events` message to Redis.
5. **Real-Time Notification**: The Express server intercepts the Redis event and uses Socket.IO to notify the specific user's browser that the file is ready for download!

---

## 🚀 Getting Started

### Run via Docker Compose (Recommended)

Requires [Docker Desktop](https://www.docker.com/products/docker-desktop/). This single command will build the images and launch the entire load-balanced cluster.

```bash
# Clone the repository
git clone https://github.com/AAASHISHPATEL/Large-File-Sharing-System.git
cd Large-File-Sharing-System

# Start the full architecture in the background
docker compose up -d --build
```

**Services Launched:**
- 🌐 **Web App & API**: `http://localhost:8080` (Routed by Nginx to App1/App2)
- 🐇 **RabbitMQ Dashboard**: `http://localhost:15672` (guest / guest)
- 🪣 **MinIO Console**: `http://localhost:9001` (minioadmin / minioadminpassword)

---

## 🌐 API Reference

### Auth
- `POST /auth/register` (Rate-limited)
- `POST /auth/login` (Rate-limited)

### File Operations (Requires JWT `Authorization: Bearer <token>`)
- `GET /upload/files`: Retrieve all files (Accelerated via Redis Cache)
- `POST /upload/init`: Start a chunked upload session
- `POST /upload/chunk`: Upload a binary file chunk (Rate-limited to 600/min)
- `GET /upload/status/:uploadId`: Retrieve missing chunks for resumption
- `POST /upload/complete`: Enqueue job to RabbitMQ for stitching
- `GET /upload/presign/:fileId`: Generate a direct download URL from MinIO
- `POST /upload/share/:fileId`: Share a file with another user via ACL

---

## 🛠️ Tech Stack & Tooling

| Technology | Purpose |
|---|---|
| **Node.js 18 & TypeScript** | Fast, statically-typed async backend |
| **Express.js** | HTTP REST Framework |
| **PostgreSQL 15** | Relational Metadata & ACL Storage |
| **Redis 7** | Sliding Window Rate Limiting, Write-Through Caching, Pub/Sub |
| **RabbitMQ 3** | Durable Message Queue (`amqplib`) |
| **MinIO** | S3-Compatible Object Storage |
| **Socket.IO** | Real-time browser synchronization |
| **Nginx** | Reverse Proxy & Load Balancing |
| **Docker Compose** | Multi-container orchestration |

---

## 📝 License

ISC License
