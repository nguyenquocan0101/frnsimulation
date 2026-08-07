# FR5 read-only telemetry bridge

Bridge này nối telemetry FAIRINO FR5 với simulator web. Nó chỉ đọc frame trạng
thái TCP/8083 rồi phát JSON qua WebSocket; không có endpoint nhận lệnh chuyển động.

Bridge chỉ báo `connected: true` sau khi nhận được frame hợp lệ. Trang Web App
tại `http://192.168.58.2` có thể mở được nhưng không cần đăng nhập để đọc cổng
telemetry 8083.

## Chạy trên máy đang cắm LAN với FR5

```powershell
cd W:\farino_fr3\07_web_simulator
python .\bridge\fr3_bridge.py --robot-ip 192.168.58.2 --transport 8083
```

Mở simulator tại `http://localhost:8080/`, bấm **Connect live**. Mặc định web
kết nối tới `ws://127.0.0.1:8765`.

Nếu web mở từ máy khác, cho bridge lắng nghe trên card LAN và truyền URL WebSocket:

```powershell
python .\bridge\fr3_bridge.py --host 0.0.0.0 --robot-ip 192.168.58.2
```

Mở `http://<IP-máy-bridge>:8080/?live=1&ws=ws%3A%2F%2F<IP-máy-bridge>%3A8765`.

## Kiểm thử không có robot

```powershell
python .\bridge\fr3_bridge.py --mock
```

## Ghi chú an toàn

Bridge này là mirror telemetry, không phải bộ điều khiển. Khi **Connect live**
được bật, các nút motion của simulator bị khóa và dữ liệu chỉ đi một chiều:
robot thật → TCP/8083 → bridge → mô hình 3D.

Bridge strict chỉ nhận `--transport 8083`; không có SDK/CNDE fallback vì các
transport đó có thể mở kênh cấu hình realtime trên controller. Safety fields nằm
ngoài payload 8083 hiện tại nên được phát dưới dạng `null`/Unavailable, không tự
suy đoán.

Payload đã kiểm chứng: `program_state` byte 0, `robot_state` byte 1,
`main_code` int32 byte 2, `sub_code` int32 byte 6, `robot_mode` byte 10,
6 joint doubles byte 11, 6 TCP doubles byte 59. Joint dùng độ; TCP dùng mm và độ.
