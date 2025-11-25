// index.js (Đã cập nhật tính năng Failover API Key)

const express = require('express');
const fetch = require('node-fetch'); 
const { GoogleGenAI } = require('@google/genai');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;
const PING_INTERVAL_MS = 20 * 1000;

// Lấy danh sách key từ biến môi trường và tách thành mảng
const GEMINI_KEY_LIST = process.env.GEMINI_API_KEYS 
    ? process.env.GEMINI_API_KEYS.split(',').map(key => key.trim())
    : [];

let ai = null; // Biến toàn cục để lưu trữ client Gemini hoạt động
let workingKey = null; // Key đang hoạt động

const model = 'gemini-2.5-flash';
const selfUrl = `http://localhost:${PORT}`;

app.use(express.json());

// --- 1. Hàm Khởi tạo và Kiểm tra API Key ---
async function initializeGeminiClient() {
    if (GEMINI_KEY_LIST.length === 0) {
        console.error("Lỗi: GEMINI_API_KEYS không được tìm thấy hoặc danh sách rỗng.");
        return false;
    }

    console.log(`Đang kiểm tra ${GEMINI_KEY_LIST.length} API Key...`);

    for (const key of GEMINI_KEY_LIST) {
        if (!key) continue; // Bỏ qua key rỗng
        
        const currentAi = new GoogleGenAI({ apiKey: key });

        try {
            // Thực hiện một cuộc gọi API đơn giản để kiểm tra key (ví dụ: tạo nội dung)
            await currentAi.models.generateContent({
                model: 'gemini-2.5-flash',
                contents: 'xin chao' 
            });

            // Nếu thành công, đây là key đang hoạt động
            ai = currentAi;
            workingKey = key;
            console.log(`✅ Thành công! Đã tìm thấy API Key hoạt động (Key: ${key.substring(0, 4)}...${key.slice(-4)}).`);
            return true; 
        } catch (error) {
            console.warn(`❌ Key thất bại (Key: ${key.substring(0, 4)}...${key.slice(-4)}). Đang thử Key tiếp theo.`);
        }
    }

    console.error("💔 Không có API Key Gemini nào hoạt động trong danh sách.");
    return false; 
}


// --- 2. Endpoint GỌI API GEMINI với Search Grounding ---
app.get('/api/gemini-search', async (req, res) => {
    if (!ai) {
        return res.status(503).json({ 
            error: 'Dịch vụ Gemini không sẵn sàng.', 
            note: 'Không có API Key nào hoạt động khi khởi động server.' 
        });
    }
    
    const prompt = req.query.prompt; 

    if (!prompt) {
        return res.status(400).json({ error: 'Vui lòng cung cấp tham số "prompt" (câu hỏi) để Gemini trả lời.' });
    }

    try {
        console.log(`Đang gọi Gemini (Sử dụng key: ...${workingKey.slice(-4)}) cho prompt: ${prompt}`);

        const response = await ai.models.generateContent({
            model: model,
            contents: prompt,
            config: {
                // Kích hoạt Search Grounding
                tools: [{ googleSearch: {} }] 
            }
        });

        const groundingMetadata = response.candidates?.[0]?.groundingMetadata;
        const searchSources = groundingMetadata?.groundingChunks || [];

        res.status(200).json({ 
            query: prompt,
            answer: response.text,
            sources: searchSources.map(chunk => ({
                title: chunk.title,
                uri: chunk.web.uri 
            })),
            used_key: workingKey.substring(0, 4) + '...' + workingKey.slice(-4),
            note: 'Câu trả lời được hỗ trợ bởi Google Search.'
        });
        
    } catch (error) {
        console.error('Lỗi khi gọi API Gemini:', error.message);
        // Trong trường hợp key hoạt động bị lỗi sau đó, cần cơ chế kiểm tra lại
        res.status(500).json({ error: 'Lỗi server khi xử lý API Gemini (có thể Key đã hết hạn hoặc bị giới hạn).', details: error.message });
    }
});


// --- 3. Endpoint Gốc & Tự Ping (Giữ nguyên) ---
app.get('/', (req, res) => {
    res.send('Server đang chạy. Endpoint API Gemini với Search Grounding là /api/gemini-search?prompt=...');
});

function startSelfPing() {
    const pingUrl = selfUrl + '/'; 
    
    setInterval(async () => {
        try {
            const response = await fetch(pingUrl);
            if (response.ok) {
                console.log(`[Self-Ping] Ping thành công đến ${pingUrl} lúc: ${new Date().toLocaleTimeString()}`);
            } else {
                 console.warn(`[Self-Ping] Ping thất bại: HTTP Status ${response.status}`);
            }
        } catch (error) {
            console.error(`[Self-Ping] Lỗi khi thực hiện ping: ${error.message}`);
        }
    }, PING_INTERVAL_MS);
    
    console.log(`Tính năng tự ping đã khởi động, server sẽ tự ping mỗi ${PING_INTERVAL_MS / 1000} giây.`);
}


// --- Khởi động Server ---
(async () => {
    const isClientInitialized = await initializeGeminiClient();
    
    if (isClientInitialized) {
        app.listen(PORT, () => {
            console.log(`✨ Server đang chạy tại: ${selfUrl}`);
            startSelfPing(); 
        });
    } else {
        console.warn("Server không thể khởi động endpoint API Gemini vì không tìm thấy key hoạt động.");
        // Bạn có thể chọn khởi động server với chức năng bị giới hạn, hoặc exit
        // process.exit(1); 
    }
})();
