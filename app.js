const express = require('express');
const app = express();
const PORT = process.env.PORT || 3000;

// Sử dụng middleware để parse JSON và URL-encoded
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// RAM Storage
let coordinatesMemory = [];

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
    const distance = R * c; // Khoảng cách tính bằng mét
    return distance;
}

// 1. ROUTE: '/' - Auto-ping giữ server thức
app.get('/', (req, res) => {
    res.status(200).send('Server is alive and kicking!');
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

    // Nếu đã có dữ liệu trong RAM, tiến hành so sánh với điểm gần nhất (cuối cùng trong mảng)
    if (coordinatesMemory.length > 0) {
        const lastLocation = coordinatesMemory[coordinatesMemory.length - 1];
        const distance = getDistanceInMeters(lastLocation.lat, lastLocation.lon, lat, lon);

        // Nếu khoảng cách giữa điểm mới và điểm cũ nhỏ hơn 10 mét
        if (distance < 10) {
            console.log(`[Bỏ qua] Điểm mới cách điểm cũ chỉ ${distance.toFixed(2)}m (< 10m). Giữ nguyên vị trí cũ.`);
            return res.status(200).json({
                success: true,
                message: `Tọa độ trùng/quá gần vị trí cũ (${distance.toFixed(1)}m < 10m). Đã tự động gộp vào điểm cũ.`,
                merged: true,
                data: lastLocation // Trả về thông tin điểm cũ đang được giữ lại
            });
        }
    }

    // Nếu là điểm đầu tiên hoặc cách điểm cũ >= 10m thì lưu mới bình thường
    const newLocation = {
        lat,
        lon,
        timestamp: new Date().toLocaleString('vi-VN')
    };

    coordinatesMemory.push(newLocation);

    // Giới hạn RAM tối đa 500 điểm
    if (coordinatesMemory.length > 500) {
        coordinatesMemory.shift();
    }

    console.log(`[Đã lưu] Điểm mới cách điểm cũ >= 10m. Lat: ${lat}, Lon: ${lon} lúc ${newLocation.timestamp}`);
    
    res.status(200).json({ 
        success: true, 
        message: 'Lưu tọa độ mới thành công!', 
        merged: false,
        data: newLocation 
    });
});

// Endpoint phụ lấy dữ liệu JSON cho bản đồ
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
            <p style="font-size: 11px; color: gray;">Tự động lọc các điểm di chuyển dưới 10m và cập nhật mỗi 5 giây...</p>
        </div>

        <div id="map"></div>

        <script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
        <script>
            const map = L.map('map').setView([16.047079, 108.206230], 6);

            L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
                attribution: '© OpenStreetMap contributors'
            }).addTo(map);

            let markerGroup = L.layerGroup().addTo(map);

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
                            .bindPopup(\`<b>Điểm số:</b> \${index + 1}<br><b>Lat:</b> \${coord.lat}<br><b>Lon:</b> \${coord.lon}<br><b>Thời gian cập nhật:</b> \${coord.timestamp}\`);
                        
                        markerGroup.addLayer(marker);

                        if (isLast) {
                            marker.openPopup();
                            map.setView([coord.lat, coord.lon], map.getZoom());
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

app.listen(PORT, () => {
    console.log(`============ SERVER RUNNING ============`);
    console.log(`[*] Server chạy tại: http://localhost:${PORT}`);
    console.log(`[*] Bộ lọc tự động gộp các điểm có khoảng cách < 10 mét đã được kích hoạt.`);
    console.log(`========================================`);
});
