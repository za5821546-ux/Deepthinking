const express = require('express');
const app = express();
const PORT = process.env.PORT || 3000;

// Sử dụng middleware để parse JSON và URL-encoded
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// RAM Storage - Lưu danh sách tọa độ dưới dạng mảng các Object
// Cấu trúc: { lat: number, lon: number, timestamp: string }
let coordinatesMemory = [];

// 1. ROUTE: '/' - Auto-ping giữ server thức
app.get('/', (req, res) => {
    res.status(200).send('Server is alive and kicking!');
});

// 2. ROUTE: '/locate' - Nhận lat, lon và lưu vào RAM
// Hỗ trợ cả GET (qua query: /locate?lat=21.0285&lon=105.8542) và POST
app.all('/locate', (req, res) => {
    const lat = parseFloat(req.query.lat || req.body.lat);
    const lon = parseFloat(req.query.lon || req.body.lon);

    if (isNaN(lat) || isNaN(lon)) {
        return res.status(400).json({ 
            success: false, 
            message: 'Thiếu hoặc sai định dạng tọa độ lat, lon!' 
        });
    }

    const newLocation = {
        lat,
        lon,
        timestamp: new Date().toLocaleString('vi-VN')
    };

    // Lưu vào RAM
    coordinatesMemory.push(newLocation);

    // Giới hạn RAM chỉ lưu tối đa 500 điểm gần nhất để tránh tràn bộ nhớ
    if (coordinatesMemory.length > 500) {
        coordinatesMemory.shift();
    }

    console.log(`[Đã lưu] Lat: ${lat}, Lon: ${lon} vào lúc ${newLocation.timestamp}`);
    
    res.status(200).json({ 
        success: true, 
        message: 'Lưu tọa độ thành công!', 
        data: newLocation 
    });
});

// Endpoint phụ để phía Frontend Map gọi lấy dữ liệu JSON mới nhất
app.get('/api/coordinates', (req, res) => {
    res.json(coordinatesMemory);
});

// 3. ROUTE: '/map' - Hiển thị bản đồ Leaflet cập nhật liên tục
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
            <p>Số điểm đã lưu: <span id="count">0</span></p>
            <p style="font-size: 11px; color: gray;">Tự động cập nhật mỗi 5 giây...</p>
        </div>

        <div id="map"></div>

        <script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
        
        <script>
            // Khởi tạo bản đồ, mặc định tâm ở Việt Nam
            const map = L.map('map').setView([16.047079, 108.206230], 6);

            // Thêm lớp bản đồ OpenStreetMap
            L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
                attribution: '© OpenStreetMap contributors'
            }).addTo(map);

            // Layer group để chứa các marker (dễ xóa và vẽ lại khi cập nhật)
            let markerGroup = L.layerGroup().addTo(map);

            // Hàm fetch dữ liệu từ server và cập nhật lên bản đồ
            async function updateMap() {
                try {
                    const response = await fetch('/api/coordinates');
                    const data = await response.json();
                    
                    // Cập nhật số lượng điểm hiển thị
                    document.getElementById('count').innerText = data.length;

                    // Xóa các marker cũ
                    markerGroup.clearLayers();

                    if (data.length === 0) return;

                    // Vẽ marker mới cho tất cả các điểm trong RAM
                    data.forEach((coord, index) => {
                        const isLast = index === data.length - 1;
                        
                        // Marker điểm cuối cùng sẽ có màu đỏ (hoặc icon đặc biệt), các điểm cũ màu xanh tiêu chuẩn
                        const marker = L.marker([coord.lat, coord.lon])
                            .bindPopup(\`<b>Điểm số:</b> \${index + 1}<br><b>Lat:</b> \${coord.lat}<br><b>Lon:</b> \${coord.lon}<br><b>Thời gian:</b> \${coord.timestamp}\`);
                        
                        markerGroup.addLayer(marker);

                        // Nếu là điểm mới nhất được cập nhật, tự động di chuyển bản đồ tới đó
                        if (isLast) {
                            marker.openPopup();
                            map.setView([coord.lat, coord.lon], map.getZoom()); // Giữ nguyên độ zoom hiện tại
                        }
                    });

                } catch (error) {
                    console.error('Lỗi khi cập nhật bản đồ:', error);
                }
            }

            // Gọi cập nhật ngay khi load trang
            updateMap();

            // Thiết lập cập nhật liên tục mỗi 5 giây (5000ms)
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
    console.log(`[*] Auto-ping:      http://localhost:${PORT}/`);
    console.log(`[*] Gửi tọa độ:     http://localhost:${PORT}/locate?lat=[vĩ_độ]&lon=[kinh_độ]`);
    console.log(`[*] Xem bản đồ:     http://localhost:${PORT}/map`);
    console.log(`========================================`);
});
