# 📦 Large File Sharing System

A production-ready, scalable backend system for uploading and sharing large files using **chunked uploads**, **resumable transfers**, and **real-time progress tracking** via WebSockets. Built with Node.js, TypeScript, PostgreSQL, Redis, and MinIO.

---

## 🏗️ Architecture Overview

```
Client
  │
  ▼
┌─────────────────────────────────────────┐
│            Nginx Load Balancer          │  ← Port 8080 (Docker)
│         (Round-Robin, 2 instances)      │
└────────────┬──────────────┬────────────┘
             │              │
        ┌────▼────┐    ┌────▼────┐
        │  App 1  │    │  App 2  │   ← Node.js / Express (Port 3000)
        └────┬────┘    └────┬────┘
             │              │
   ┌─────────▼──────────────▼──────────┐
   │                                    │
┌──▼───┐    ┌──────────┐    ┌────────┐ │
│Redis │    │PostgreSQL│    │ MinIO  │ │
│6379  │    │  5432    │    │  9000  │ │
└──────┘    └──────────┘    └────────┘ │
   └─────────────────────────────────────┘
```

### Why This Architecture?

| Component | Role | Why |
|-----------|------|-----|
| **Express.js** | HTTP API server | Lightweight, fast, well-supported |
| **PostgreSQL** | Persistent metadata storage | ACID-compliant, stores file records & ACLs |
| **Redis** | Upload session state + pub/sub | Fast in-memory tracking of chunk progress |
| **MinIO** | Object storage (S3-compatible) | Stores the final assembled files permanently |
| **Socket.IO** | Real-time progress events | Clients get live upload progress without polling |
| **Redis Adapter** | Socket.IO multi-instance sync | Ensures WebSocket events work across multiple app instances |
| **Nginx** | Load balancer | Distributes traffic across app instances horizontally |

---

## ✨ Features

- ✅ **Chunked File Upload** — Split large files into chunks and upload them independently
- ✅ **Resumable Uploads** — Check which chunks arrived; re-send only missing ones
- ✅ **Real-Time Progress** — WebSocket events stream upload progress to the client live
- ✅ **JWT Authentication** — Register/login with secure token-based auth
- ✅ **File Access Control** — Owner-based ACL stored in PostgreSQL
- ✅ **MinIO Object Storage** — Files stored permanently in S3-compatible storage
- ✅ **Horizontal Scalability** — Multiple app instances synced via Redis adapter
- ✅ **Docker Compose** — One command to spin up the entire stack

---

## 🗂️ Project Structure

```
Large File Sharing System/
├── src/
│   ├── index.ts                  # App entry point, server bootstrap
│   ├── config/
│   │   └── db.ts                 # PostgreSQL pool + table initialization
│   ├── middleware/
│   │   └── authMiddleware.ts     # JWT verification middleware
│   ├── routes/
│   │   ├── auth.ts               # /auth/register, /auth/login
│   │   └── upload.ts             # /upload/init, /upload/chunk, /upload/complete, /upload/status
│   └── services/
│       ├── redisClient.ts        # Redis connection client
│       ├── minioClient.ts        # MinIO client + bucket initialization
│       ├── uploadService.ts      # Core chunked upload logic
│       └── websocket.ts          # Socket.IO server + Redis adapter
├── public/
│   └── index.html                # Frontend UI for testing uploads
├── scripts/
│   ├── testUpload.js             # Script to test a full upload flow
│   └── testResume.js             # Script to test resumable upload
├── docker-compose.yml            # Full stack: Redis, MinIO, PostgreSQL, App ×2, Nginx
├── Dockerfile                    # App container build
├── nginx.conf                    # Load balancer config
├── .env                          # Local environment variables (do NOT commit)
├── tsconfig.json                 # TypeScript config
└── package.json
```

---

## 🔄 Upload Flow (Step by Step)

```
1. POST /auth/register      → Create an account
2. POST /auth/login         → Get a JWT token
3. POST /upload/init        → Start an upload session → returns uploadId
4. WebSocket connect        → Join room: socket.emit('joinUploadRoom', uploadId)
5. POST /upload/chunk       → Upload each chunk (repeat for all chunks)
                              ← Server emits 'progress' events in real-time
6. GET  /upload/status/:id  → (Optional) Check which chunks arrived for resumption
7. POST /upload/complete    → Stitch chunks → upload to MinIO → cleanup
                              ← Server emits 'UPLOAD_COMPLETE' event
```

---

## 🌐 API Reference

### Auth

#### `POST /auth/register`
```json
// Request
{ "username": "ashish", "password": "mypassword" }

// Response 201
{ "user": { "id": "uuid", "username": "ashish" } }
```

#### `POST /auth/login`
```json
// Request
{ "username": "ashish", "password": "mypassword" }

// Response 200
{ "token": "eyJ...", "user": { "id": "uuid", "username": "ashish" } }
```

---

### Upload (all routes require `Authorization: Bearer <token>`)

#### `POST /upload/init`
Initializes an upload session and creates a DB record.
```json
// Request
{ "filename": "bigvideo.mp4", "totalSize": 104857600 }

// Response 200
{ "uploadId": "uuid-v4" }
```

#### `POST /upload/chunk`
Uploads a single chunk. Use `multipart/form-data`.
```
Form fields:
  - uploadId   (string)
  - chunkIndex (number, 0-based)
  - chunk      (file binary)
```
```json
// Response 200
{ "success": true, "message": "Chunk 0 received" }
```

#### `GET /upload/status/:uploadId`
Returns which chunks have been received — used to **resume** an interrupted upload.
```json
// Response 200
{
  "uploadId": "uuid",
  "totalSize": "104857600",
  "receivedChunks": [0, 1, 2, 5]
}
```

#### `POST /upload/complete`
Stitches all chunks in order, uploads the assembled file to MinIO, then cleans up temp files.
```json
// Request
{ "uploadId": "uuid", "totalChunks": 10 }

// Response 200
{ "success": true, "finalPath": "filesharing/uuid-bigvideo.mp4" }
```

---

### WebSocket Events

Connect to `ws://localhost:3000` using Socket.IO.

| Event (emit) | Payload | Description |
|---|---|---|
| `joinUploadRoom` | `uploadId` | Subscribe to progress for a specific upload |

| Event (receive) | Payload | Description |
|---|---|---|
| `progress` | `{ event: 'CHUNK_WRITTEN', chunkIndex, processingTimeMs }` | Each chunk received |
| `progress` | `{ event: 'STITCHING_STARTED' }` | Chunks being merged |
| `progress` | `{ event: 'UPLOADING_TO_MINIO' }` | File being sent to MinIO |
| `progress` | `{ event: 'UPLOAD_COMPLETE', minioPath }` | Upload fully done |

---

## 🗄️ Database Schema

```sql
-- Users table
CREATE TABLE users (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    username      VARCHAR(255) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    created_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Files metadata table
CREATE TABLE files (
    id         UUID PRIMARY KEY,
    filename   VARCHAR(255) NOT NULL,
    total_size BIGINT NOT NULL,
    s3_path    VARCHAR(255),               -- MinIO object path after completion
    status     VARCHAR(50) DEFAULT 'UPLOADING',  -- 'UPLOADING' | 'COMPLETED'
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Access control list
CREATE TABLE file_acls (
    file_id         UUID REFERENCES files(id) ON DELETE CASCADE,
    user_id         UUID REFERENCES users(id) ON DELETE CASCADE,
    permission_type VARCHAR(50) NOT NULL,  -- 'OWNER' | 'READ' | 'WRITE'
    PRIMARY KEY (file_id, user_id)
);
```

---

## 🚀 Getting Started

### Option 1: Docker Compose (Recommended)

> Requires [Docker Desktop](https://www.docker.com/products/docker-desktop/)

```bash
# Clone the repo
git clone https://github.com/AAASHISHPATEL/Large-File-Sharing-System.git
cd Large-File-Sharing-System

# Start everything
docker compose up --build
```

The app will be available at `http://localhost:8080` (via Nginx).

---

### Option 2: Run Locally (Manual)

#### Prerequisites
- Node.js 18+
- PostgreSQL 15+
- Redis 5+
- MinIO server

#### 1. Install dependencies
```bash
npm install
```

#### 2. Create `.env` file
```env
PORT=3000

# PostgreSQL
POSTGRES_HOST=localhost
POSTGRES_USER=postgres
POSTGRES_PASSWORD=your_postgres_password
POSTGRES_DB=filesharing

# Redis
REDIS_URL=redis://localhost:6379

# MinIO
MINIO_ENDPOINT=localhost
MINIO_PORT=9000
MINIO_ACCESS_KEY=minioadmin
MINIO_SECRET_KEY=minioadminpassword
MINIO_USE_SSL=false

# JWT
JWT_SECRET=your_super_secret_jwt_key
```

#### 3. Create the database
```bash
psql -U postgres -c "CREATE DATABASE filesharing;"
```

#### 4. Start MinIO
```powershell
$env:MINIO_ROOT_USER = "minioadmin"
$env:MINIO_ROOT_PASSWORD = "minioadminpassword"
C:\minio.exe server C:\minio-data --console-address ":9001"
```

#### 5. Run the server
```bash
npm run dev
```

Server starts at `http://localhost:3000` 🚀

---

## 🧪 Testing

Two test scripts are included in the `scripts/` folder:

```bash
# Test a full upload from scratch
node scripts/testUpload.js

# Test resumable upload (simulates a partial upload then resumes)
node scripts/testResume.js
```

You can also use the built-in frontend UI at `http://localhost:3000`.

---

## 🔧 Environment Variables

| Variable | Default | Description |
|---|---|---|
| `PORT` | `3000` | Server port |
| `POSTGRES_HOST` | `localhost` | PostgreSQL host |
| `POSTGRES_USER` | `admin` | PostgreSQL user |
| `POSTGRES_PASSWORD` | — | PostgreSQL password |
| `POSTGRES_DB` | `filesharing` | PostgreSQL database name |
| `REDIS_URL` | `redis://localhost:6379` | Redis connection URL |
| `MINIO_ENDPOINT` | `localhost` | MinIO host |
| `MINIO_PORT` | `9000` | MinIO API port |
| `MINIO_ACCESS_KEY` | `minioadmin` | MinIO access key |
| `MINIO_SECRET_KEY` | `minioadminpassword` | MinIO secret key |
| `MINIO_USE_SSL` | `false` | Enable SSL for MinIO |
| `JWT_SECRET` | `super-secret-key-for-dev` | Secret for signing JWT tokens |

---

## 🛠️ Tech Stack

| Technology | Version | Purpose |
|---|---|---|
| Node.js | 20.x | Runtime |
| TypeScript | 7.x | Type safety |
| Express.js | 5.x | HTTP framework |
| PostgreSQL | 15+ | Relational database |
| Redis | 5+ | Session state & pub/sub |
| MinIO | latest | S3-compatible object storage |
| Socket.IO | 4.x | Real-time WebSocket events |
| Multer | 2.x | Multipart file upload handling |
| bcryptjs | 3.x | Password hashing |
| jsonwebtoken | 9.x | JWT auth |
| Nginx | alpine | Load balancer |
| Docker Compose | 3.8 | Container orchestration |

---

## 📝 License

ISC
