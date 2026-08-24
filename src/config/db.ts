import { Pool } from 'pg';

const pool = new Pool({
    user: process.env.POSTGRES_USER || 'admin',
    host: process.env.POSTGRES_HOST || 'localhost',
    database: process.env.POSTGRES_DB || 'filesharing',
    password: process.env.POSTGRES_PASSWORD || 'adminpassword',
    port: parseInt(process.env.POSTGRES_PORT || '5432', 10),
});

export const initializeDB = async () => {
    const client = await pool.connect();
    try {
        console.log('Connected to PostgreSQL');

        // Create Users Table
        await client.query(`
            CREATE TABLE IF NOT EXISTS users (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                username VARCHAR(255) UNIQUE NOT NULL,
                password_hash VARCHAR(255) NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        `);

        // Create Files Metadata Table
        await client.query(`
            CREATE TABLE IF NOT EXISTS files (
                id UUID PRIMARY KEY,
                filename VARCHAR(255) NOT NULL,
                total_size BIGINT NOT NULL,
                s3_path VARCHAR(255),
                status VARCHAR(50) DEFAULT 'UPLOADING',
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        `);

        // Create Access Control Lists Table
        await client.query(`
            CREATE TABLE IF NOT EXISTS file_acls (
                file_id UUID REFERENCES files(id) ON DELETE CASCADE,
                user_id UUID REFERENCES users(id) ON DELETE CASCADE,
                permission_type VARCHAR(50) NOT NULL, -- 'OWNER', 'READ', 'WRITE'
                PRIMARY KEY (file_id, user_id)
            );
        `);

        console.log('Database tables initialized');
    } catch (err) {
        console.error('Error initializing database:', err);
        throw err;
    } finally {
        client.release();
    }
};

export default pool;
