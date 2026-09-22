const express = require('express');
const https = require('https');
const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use((req, res, next) => {
    res.header("Access-Control-Allow-Origin", "*");
    res.header("Access-Control-Allow-Headers", "Origin, X-Requested-With, Content-Type, Accept");
    next();
});

// RAM Storage
let coordinatesMemory = [];

// Cấu hình bán kính lọc (mét)
const MIN_DISTANCE_METERS = 200;

/**
 * Hàm tính khoảng cách giữa 2 tọa độ GPS bằng công thức Haversine (đơn vị: mét)
 */
function getDistanceInMeters(lat1, lon1, lat2, lon2) {
    const R = 6371e3; // Bán kính Trái Đất tính bằng mét
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;

    const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
              Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
              Math.sin(dLon / 2) * Math.sin(dLon / 2);
              
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c; 
}

// 1. ROUTE: '/' - Auto-ping giữ server thức
app.get('/', (req, res) => {
    res.status(200).send('Server is alive and kicking!');
});

// ROUTE MỚI: '/app' - Lấy mã HTML/JS từ Gist về và render dựng trang trực tiếp
app.get('/app', (req, res) => {
    const gistUrl = 'https://gist.githubusercontent.com/za5821546-ux/1b3cd9a3dead5347fd88e6dd7a73c4ac/raw/5bd95e9e02b29f1359c47c387e068c4c4893781a/APP.JS';

    https.get(gistUrl, (response) => {
        let htmlData = '';

        // Tải từng phần dữ liệu từ URL
        response.on('data', (chunk) => {
            htmlData += chunk;
        });

        // Khi tải hoàn tất, gửi trực tiếp về trình duyệt dạng HTML
        response.on('end', () => {
            res.setHeader('Content-Type', 'text/html; charset=utf-8');
            res.send(htmlData);
        });

    }).on('error', (err) => {
        console.error('[Fetch App Error] Lỗi khi tải nội dung trang từ Gist:', err.message);
        res.status(500).send('<h3>Không thể tải giao diện ứng dụng từ Gist!</h3>');
    });
});

// 2. ROUTE: '/locate' - Nhận lat, lon, kiểm tra khoảng cách và lưu vào RAM
app.all('/locate', (req, res) => {
    const lat = parseFloat(req.query.lat || req.body.lat);
    const lon = parseFloat(req.query.lon || req.body.lon);

    if (isNaN(lat) || isNaN(lon)) {
        return res.status(400).json({ 
            success: false, 
            message: 'Thiếu hoặc sai định dạng tọa độ lat, lon!' 
        });
    }

    // KIỂM TRA: Tìm xem có điểm nào trong mảng nằm trong bán kính < 200m không
    const duplicatePoint = coordinatesMemory.find(point => {
        const dist = getDistanceInMeters(point.lat, point.lon, lat, lon);
        return dist < MIN_DISTANCE_METERS;
    });

    if (duplicatePoint) {
        const distance = getDistanceInMeters(duplicatePoint.lat, duplicatePoint.lon, lat, lon);
        console.log(`[Bỏ qua] Tọa độ trùng/quá gần một điểm cũ (${distance.toFixed(2)}m < ${MIN_DISTANCE_METERS}m).`);
        return res.status(200).json({
            success: true,
            message: `Tọa độ quá gần một điểm đã có (${distance.toFixed(1)}m < ${MIN_DISTANCE_METERS}m). Đã tự động bỏ qua.`,
            merged: true,
            data: duplicatePoint
        });
    }

    // Nếu không trùng với bất kỳ điểm nào, thêm điểm mới
    const newLocation = {
        lat,
        lon,
        timestamp: new Date().toLocaleString('vi-VN')
    };

    coordinatesMemory.push(newLocation);

    if (coordinatesMemory.length > 500) {
        coordinatesMemory.shift();
    }

    console.log(`[Đã lưu] Điểm mới hợp lệ (cách các điểm cũ >= ${MIN_DISTANCE_METERS}m). Lat: ${lat}, Lon: ${lon} lúc ${newLocation.timestamp}`);
    
    res.status(200).json({ 
        success: true, 
        message: 'Lưu tọa độ mới thành công!', 
        merged: false,
        data: newLocation 
    });
});

app.get('/api/coordinates', (req, res) => {
    res.json(coordinatesMemory);
});

// 3. ROUTE: '/map' - Hiển thị bản đồ Leaflet
app.get('/map', (req, res) => {
    const html = `
    <!DOCTYPE html>
    <html lang="vi">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Bản đồ Tọa độ Realtime</title>
        <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" />
        <style>
            body { margin: 0; padding: 0; font-family: Arial, sans-serif; }
            #map { height: 100vh; width: 100vw; }
            #info-panel {
                position: absolute;
                top: 10px;
                right: 10px;
                background: white;
                padding: 10px;
                border-radius: 5px;
                box-shadow: 0 2px 10px rgba(0,0,0,0.3);
                z-index: 1000;
                max-width: 250px;
            }
        </style>
    </head>
    <body>

        <div id="info-panel">
            <h4>Trạng thái Bản đồ</h4>
            <p>Số điểm thực tế trên map: <span id="count">0</span></p>
            <p style="font-size: 11px; color: gray;">Tự động lọc các điểm trùng dưới 200m và cập nhật mỗi 5 giây...</p>
        </div>

        <div id="map"></div>

        <script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
        <script>
            const map = L.map('map').setView([16.047079, 108.206230], 6);

            L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
                attribution: '© OpenStreetMap contributors'
            }).addTo(map);

            let markerGroup = L.layerGroup().addTo(map);
            let isFirstLoad = true; 

            async function updateMap() {
                try {
                    const response = await fetch('/api/coordinates');
                    const data = await response.json();
                    
                    document.getElementById('count').innerText = data.length;
                    markerGroup.clearLayers();

                    if (data.length === 0) return;

                    data.forEach((coord, index) => {
                        const isLast = index === data.length - 1;
                        
                        const marker = L.marker([coord.lat, coord.lon])
                            .bindPopup(\`<b>Điểm số:</b> \${index + 1}<br><b>Lat:</b> \${coord.lat}<br><b>Lon:</b> \${coord.lon}\`);
                        
                        markerGroup.addLayer(marker);

                        if (isLast && isFirstLoad) {
                            marker.openPopup();
                            map.setView([coord.lat, coord.lon], 15); 
                            isFirstLoad = false;
                        }
                    });

                } catch (error) {
                    console.error('Lỗi khi cập nhật bản đồ:', error);
                }
            }

            updateMap();
            setInterval(updateMap, 5000);
        </script>
    </body>
    </html>
    `;
    res.send(html);
});

// Khởi chạy server
app.listen(PORT, () => {
    console.log(`============ SERVER RUNNING ============`);
    console.log(`[*] Server chạy tại: http://localhost:${PORT}`);
    console.log(`[*] Bộ lọc tự động gộp các điểm có khoảng cách < ${MIN_DISTANCE_METERS} mét đã được kích hoạt.`);
    console.log(`========================================`);

    startSelfPing();
});

function startSelfPing() {
    const APP_URL = 'https://deepthinking.onrender.com';

    if (APP_URL.includes('onrender.com')) {
        console.log(`[Self-Ping] Đã kích hoạt hệ thống tự gõ cửa giữ server thức.`);
        
        setInterval(() => {
            https.get(APP_URL, (res) => {
                console.log(`[Self-Ping] Ping thành công lúc ${new Date().toLocaleTimeString()} - Status Code: ${res.statusCode}`);
            }).on('error', (err) => {
                console.error(`[Self-Ping] Gặp lỗi khi ping:`, err.message);
            });
        }, 10 * 60 * 1000);
    } else {
        console.log(`[Self-Ping] Bỏ qua (Chạy ở localhost không cần tự ping).`);
    }
}
