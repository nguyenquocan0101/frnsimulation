# Brainstorm: Dải block và bài toán sắp xếp một ô đệm

**Date:** 2026-07-31

## Ideas Explored

- **Bảng quan sát tĩnh:** chỉ hiển thị block tại P1–P7. Dễ làm nhưng học sinh không thể tạo bài toán riêng.
- **Dải block kéo-thả:** người dạy/học sinh tráo vị trí ngay trong mô phỏng. Phù hợp nhất với yêu cầu tạo bài sắp xếp trực quan.
- **Sắp xếp tự động bằng buffer P7:** sinh chuỗi thao tác lấy/đặt để đưa sáu màu về P1–P6; P7 là ô trống tạm trong mỗi chu trình hoán vị.
- **Random bài tập theo Reset:** hữu ích sau này, nhưng không cần cho bản đầu vì kéo-thả đã cho phép tạo mọi hoán vị.

## User's Direction

Sáu block màu ở P1–P6 được tráo thứ tự. P7 không có block và là vị trí đệm khi robot sắp xếp. Bên cạnh icon Home có một dải ô màu đơn giản: mỗi ô là một box đầy màu, nhãn P1/P2… ở giữa. Dải phải đổi theo từng thao tác của robot và cho phép người dùng đổi vị trí các ô để robot sắp lại.

## Open Questions

- Không còn câu hỏi chặn triển khai. Cấu hình kéo-thả gần nhất là bài tập hiện hành; không có Reset quay về một hoán vị cố định.
- Kéo block vào slot đang có block sẽ đổi chỗ trực tiếp. P7 vẫn là buffer mà robot dùng trong lời giải mẫu.
- Code chỉ là lời giải mẫu được render trong editor để minh hoạ; không tự ghi đè code khi người dùng kéo-thả.

## Risks

- Cần giữ một nguồn dữ liệu duy nhất cho cả scene 3D, dải ô và code được sinh để không lệch trạng thái.
- Luồng sắp xếp phải luôn dùng P7 làm buffer, không đặt hai block cùng một vị trí.
- Chỉ mô phỏng; không tạo hoặc gửi lệnh tới robot thật/bridge.
