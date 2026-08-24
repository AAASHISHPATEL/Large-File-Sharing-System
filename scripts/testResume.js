const fs = require('fs');
const path = require('path');
const axios = require('axios');
const FormData = require('form-data');

const SERVER_URL = 'http://localhost:8080';
const CHUNK_SIZE = 5 * 1024 * 1024; // 5MB

async function testResume() {
    console.log('Registering test user for resume scenario...');
    let token = '';
    const credentials = { username: `resumeuser_${Date.now()}`, password: 'password123' };
    
    try {
        await axios.post(`${SERVER_URL}/auth/register`, credentials);
        const loginRes = await axios.post(`${SERVER_URL}/auth/login`, credentials);
        token = loginRes.data.token;
    } catch (err) {
        console.error('Failed to authenticate:', err.response?.data || err.message);
        return;
    }
    const authHeaders = { Authorization: `Bearer ${token}` };

    const dummyFilePath = path.join(__dirname, 'dummy_resume.txt');
    const totalSize = 25 * 1024 * 1024; // 25 MB
    const buffer = Buffer.alloc(totalSize, 'B');
    fs.writeFileSync(dummyFilePath, buffer);
    const totalChunks = Math.ceil(totalSize / CHUNK_SIZE);

    try {
        console.log('Initializing upload...');
        const initRes = await axios.post(`${SERVER_URL}/upload/init`, {
            filename: 'dummy_resume.txt',
            totalSize: totalSize
        }, { headers: authHeaders });
        const uploadId = initRes.data.uploadId;
        console.log(`Upload initialized. ID: ${uploadId}`);

        // Simulate uploading only half the chunks (0, 1, 2)
        console.log('Simulating partial upload (first 3 chunks) and then a "crash"...');
        for (let i = 0; i < 3; i++) {
            const chunkBuffer = buffer.subarray(i * CHUNK_SIZE, (i + 1) * CHUNK_SIZE);
            const formData = new FormData();
            formData.append('uploadId', uploadId);
            formData.append('chunkIndex', i.toString());
            formData.append('chunk', chunkBuffer, `chunk_${i}`);

            await axios.post(`${SERVER_URL}/upload/chunk`, formData, {
                headers: { ...formData.getHeaders(), ...authHeaders }
            });
            console.log(`Uploaded chunk ${i}`);
        }

        console.log('--- CLIENT RESTARTED / RESUMING ---');
        // Resume upload by checking status
        const statusRes = await axios.get(`${SERVER_URL}/upload/status/${uploadId}`, { headers: authHeaders });
        const receivedChunks = statusRes.data.receivedChunks || [];
        console.log('Server reports having chunks:', receivedChunks);

        console.log('Resuming missing chunks...');
        for (let i = 0; i < totalChunks; i++) {
            if (!receivedChunks.includes(i)) {
                console.log(`Uploading missing chunk ${i}...`);
                const chunkBuffer = buffer.subarray(i * CHUNK_SIZE, Math.min((i + 1) * CHUNK_SIZE, totalSize));
                const formData = new FormData();
                formData.append('uploadId', uploadId);
                formData.append('chunkIndex', i.toString());
                formData.append('chunk', chunkBuffer, `chunk_${i}`);

                await axios.post(`${SERVER_URL}/upload/chunk`, formData, {
                    headers: { ...formData.getHeaders(), ...authHeaders }
                });
            }
        }

        console.log('Completing upload...');
        const completeRes = await axios.post(`${SERVER_URL}/upload/complete`, {
            uploadId,
            totalChunks
        }, { headers: authHeaders });
        
        console.log('Upload successfully resumed and completed! MinIO path:', completeRes.data.finalPath);

    } catch (error) {
        console.error('Error during upload test:', error.response?.data || error.message);
    } finally {
        if (fs.existsSync(dummyFilePath)) {
            fs.unlinkSync(dummyFilePath);
        }
    }
}

testResume();
