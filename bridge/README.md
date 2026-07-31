# FR3 read-only telemetry bridge

Bridge này nối telemetry FAIRINO với simulator web. Mặc định nó đọc frame trạng
thái TCP/8083 (`jt_cur_pos`, `tl_cur_pos`) rồi phát JSON qua WebSocket; không có
endpoint nhận lệnh chuyển động.

Bridge chỉ báo `connected: true` sau khi nhận được frame hợp lệ. Trang Web App
tại `http://192.168.58.2` có thể mở được nhưng không cần đăng nhập để đọc cổng
telemetry 8083.

## Chạy trên máy đang cắm LAN với FR3

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

Nếu cần dùng SDK/CNDE thay vì 8083, chạy `--transport sdk`. Chế độ `auto` thử
8083 trước rồi mới dùng SDK.
