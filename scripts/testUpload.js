const fs = require('fs');
const path = require('path');
const axios = require('axios');
const FormData = require('form-data');

const SERVER_URL = 'http://localhost:8080';
const CHUNK_SIZE = 5 * 1024 * 1024; // 5MB

async function testUpload() {
    // 0. Register and Login to get JWT
    console.log('Registering test user...');
    let token = '';
    const credentials = { username: `testuser_${Date.now()}`, password: 'password123' };
    
    try {
        await axios.post(`${SERVER_URL}/auth/register`, credentials);
        const loginRes = await axios.post(`${SERVER_URL}/auth/login`, credentials);
        token = loginRes.data.token;
        console.log('Successfully logged in, got JWT.');
    } catch (err) {
        console.error('Failed to authenticate:', err.response?.data || err.message);
        return;
    }

    const authHeaders = { Authorization: `Bearer ${token}` };

    // 1. Create a dummy file of 12MB
    const dummyFilePath = path.join(__dirname, 'dummy.txt');
    const totalSize = 12 * 1024 * 1024;
    console.log(`Creating a 12MB dummy file at ${dummyFilePath}...`);
    const buffer = Buffer.alloc(totalSize, 'A');
    fs.writeFileSync(dummyFilePath, buffer);
    console.log('Dummy file created.');

    try {
        // 2. Init Upload
        console.log('Initializing upload...');
        const initRes = await axios.post(`${SERVER_URL}/upload/init`, {
            filename: 'dummy.txt',
            totalSize: totalSize
        }, { headers: authHeaders });
        const uploadId = initRes.data.uploadId;
        console.log(`Upload initialized. ID: ${uploadId}`);

        // 3. Upload Chunks
        const totalChunks = Math.ceil(totalSize / CHUNK_SIZE);
        const fileStream = fs.createReadStream(dummyFilePath, { highWaterMark: CHUNK_SIZE });
        
        let chunkIndex = 0;
        const uploadPromises = [];

        for await (const chunk of fileStream) {
            console.log(`Uploading chunk ${chunkIndex + 1}/${totalChunks}...`);
            const formData = new FormData();
            formData.append('uploadId', uploadId);
            formData.append('chunkIndex', chunkIndex.toString());
            formData.append('chunk', chunk, `chunk_${chunkIndex}`);

            // Sending concurrently
            const p = axios.post(`${SERVER_URL}/upload/chunk`, formData, {
                headers: { ...formData.getHeaders(), ...authHeaders }
            });
            uploadPromises.push(p);
            chunkIndex++;
        }

        await Promise.all(uploadPromises);
        console.log('All chunks uploaded successfully.');

        // 4. Complete Upload
        console.log('Completing upload...');
        const completeRes = await axios.post(`${SERVER_URL}/upload/complete`, {
            uploadId,
            totalChunks
        }, { headers: authHeaders });
        
        console.log('Upload completed! Final path on server:', completeRes.data.finalPath);

    } catch (error) {
        console.error('Error during upload test:', error.response?.data || error.message);
    } finally {
        // Cleanup dummy file
        if (fs.existsSync(dummyFilePath)) {
            fs.unlinkSync(dummyFilePath);
            console.log('Cleaned up dummy file.');
        }
    }
}

testUpload();
