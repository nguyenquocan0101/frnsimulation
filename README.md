# FAIRINO FR3 · 3D Web Simulator

Mô phỏng web local dùng đúng bộ **URDF + STL visual mesh `fairino3_v6`** đã có trong gói ROS2 của workspace. Hierarchy khớp, origin, RPY, axis và joint limit được lấy từ:

`03_ros/frcobot_ros2-main/fairino_description/urdf/fairino3_v6.urdf`

## Chạy

Không nên mở bằng `file://` vì browser có thể chặn việc tải STL. Chạy web server tĩnh:

```powershell
cd W:\farino_fr3\07_web_simulator
node .\serve.mjs 8080
```

Mở `http://localhost:8080/`.

Server này cũng chạy Python runner cục bộ cho phần Code. Học sinh có thể dùng
`def`, `with TechCamp()`, điều kiện, vòng lặp và guard
`if __name__ == "__main__":`. Runner chỉ tạo action cho mô phỏng 3D; không
import `techcamp_api.py`, Fairino SDK hoặc bridge. Máy chạy web cần có
`python` trong PATH.

Để mirror robot thật theo một chiều, mở thêm bridge ở terminal khác:

```powershell
cd W:\farino_fr3\07_web_simulator
python .\bridge\fr3_bridge.py --robot-ip 192.168.58.2 --transport 8083
```

Sau đó mở `http://localhost:8080/?live=1` hoặc bấm **Connect live**. Bridge đọc
frame telemetry TCP/8083 của controller, không đăng nhập Web App và không gửi
lệnh chuyển động.

Trang dùng Three.js từ CDN nên lần đầu cần Internet để tải runtime. Mesh FR3 nằm local trong `assets/fr3_v6/`.

## Đã triển khai

- Model 3D chính thức `fairino3_v6` gồm base, shoulder, upperarm, forearm và 3 wrist link.
- Kinematics theo URDF, không còn chiều dài link ước lượng.
- FK để đọc TCP pose và cập nhật TCP frame.
- Numerical IK Damped Least Squares cho pose `[X,Y,Z,RX,RY,RZ]`.
- `MoveJ`: nội suy joint-space có giới hạn khớp.
- `MoveL`: nội suy đường thẳng Cartesian theo TCP, giải IK từng waypoint.
- `StopMotion`, `ServoJ`, `SetSpeed`, `Mode`, `SetToolCoord`, `GetActualJointPosDegree`, `GetActualTCPPose`.
- Teach point và SDK-style whitelist parser, không dùng `eval`.
- Orbit / pan / zoom, reset view, trạng thái loading/error và responsive UI.
- Live Monitor: nhận 6 joint + TCP thật qua WebSocket read-only; khóa các nút motion khi live.

## API mô phỏng

```js
await fairinoSim.RPC("sim://FR3");
await fairinoSim.SetSpeed(35);
await fairinoSim.MoveJ([0, -35, 65, 0, 25, 0], 20, 20, 25);
await fairinoSim.MoveL([320, 0, 420, 180, 0, 90], 0, 0, 20, 20, 20);
```

Các API này là **SDK-style emulator** để học luồng lệnh. Chế độ Live Monitor chỉ
mirror telemetry, không mô phỏng dynamics/torque/encoder/I/O, chưa có collision
mesh đầy đủ và không được dùng để điều khiển robot thật.

## Deploy Vercel

Project có thể deploy như một static web kèm Python Function ở `POST /api/python/run`.
Vercel sẽ phục vụ `index.html`, model 3D và các tài nguyên tĩnh; endpoint này chạy
`python_sim_runner.py` trực tiếp trong Python Runtime để kiểm tra và mô phỏng code
của học sinh. Không cần, cũng không sử dụng `serve.mjs` trên Vercel.

1. Import repository trên Vercel và chọn branch `deployvercel`.
2. Giữ nguyên Build Command và Output Directory ở chế độ tự động/để trống.
3. Deploy. Sau đó nút **Run program** gọi cùng-domain endpoint `/api/python/run`.

Bridge và SDK kết nối robot thật không chạy trên Vercel: chúng chỉ nên chạy trên máy
nằm trong mạng LAN của robot. Phiên bản Vercel là simulator độc lập, an toàn cho lớp học.
