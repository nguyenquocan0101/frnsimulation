# Spec: Dải block tương tác và sắp xếp với P7 buffer

**Date:** 2026-07-31
**Status:** Ready

---

## Problem Statement

Học sinh cần nhìn được block màu nào đang nằm ở P1–P7 và tạo bài sắp xếp trực quan. Hiện trạng scene 3D có block nhưng không có điều khiển gọn cạnh icon Home và không sinh được chương trình sắp xếp từ trạng thái đã tráo.

---

## User Stories

- **[P1]** As a giáo viên, I want to thấy dải 7 ô màu cạnh icon Home so that tôi biết ngay block nào đang ở mỗi vị trí.
  Accepted when: dải có P1–P7; P1–P6 hiển thị màu block đang chiếm vị trí, P7 trống được thể hiện rõ, và dải cập nhật sau mọi thao tác lấy/đặt của mô phỏng.

- **[P1]** As a giáo viên, I want to kéo-thả block giữa các ô so that tôi tạo được bài sắp xếp trước khi chạy robot.
  Accepted when: có thể kéo một block P1–P6 sang ô khác, trạng thái scene 3D và dải đồng bộ ngay, và chỉ có đúng một ô trống sau mỗi lần đổi.

- **[P1]** As a học sinh, I want to nhận code Python sắp xếp theo trạng thái hiện tại so that tôi quan sát/chạy được robot đưa màu về thứ tự chuẩn P1–P6 bằng P7.
  Accepted when: chương trình sinh ra dùng các hàm TechCamp hợp lệ, giải được mọi hoán vị của sáu block, kết thúc với màu chuẩn tại P1–P6 và P7 trống.

- **[P2]** As a giáo viên, I want to giữ cấu hình kéo-thả gần nhất so that có thể chỉnh bài tập mà không bị Reset thay thế.
  Accepted when: các thao tác render/animation không làm mất hoán vị do người dùng đã tạo, trừ khi code mẫu được chạy để thực hiện bài sắp xếp.

- **[P3]** _(out of scope — noted for future)_ Tạo đề ngẫu nhiên, tính điểm số bước và kiểm tra học sinh tự viết thuật toán.

---

## Functional Requirements

1. **FR-01:** Thêm dải 7 slot cạnh nút Home trong viewport; mỗi slot là box màu đầy, label vị trí P1–P7 ở giữa, không có ảnh/minh hoạ phụ.
2. **FR-02:** Dải lấy dữ liệu trực tiếp từ cùng state block đang điều khiển mesh 3D; khi `grip`, `release`, `move_to`, reset hoặc animation thay đổi vị trí, dải phải render lại.
3. **FR-03:** P7 là buffer trống mặc định. Kéo block vào slot đang có block sẽ hoán đổi trực tiếp; kéo block vào P7 chuyển block vào buffer. Mọi thao tác bảo toàn sáu block độc nhất và đúng một slot trống.
4. **FR-04:** Render một chương trình Python TechCamp lời giải mẫu trong editor. Chuỗi thao tác chỉ dùng `move_to`, `move_down`, `move_up`, `grip`, `release`; không gọi SDK thật.
5. **FR-05:** Thuật toán sinh code phải dùng P7 để xử lý chu trình hoán vị và kết thúc ở thứ tự màu chuẩn P1→P6; P7 trống.
6. **FR-06:** Kéo-thả không tự thay nội dung editor. Lời giải mẫu được đặt khi scene bài tập được khởi tạo và vẫn có syntax highlight/có thể chạy bằng runner hiện tại.

---

## Non-Functional Requirements

- **Performance:** cập nhật dải trong cùng frame render kế tiếp sau thay đổi state; không thêm request mạng.
- **Security:** toàn bộ thao tác chỉ sửa simulator state; không bật live monitor, bridge hoặc API robot thật.
- **Availability:** khi points.json/model chưa tải xong, dải có thể hiển thị nhưng hành động render code bị khoá cho đến khi scene sẵn sàng.

---

## Success Criteria

- [ ] Dải luôn có 7 slot và luôn thể hiện đúng 6 block + 1 ô trống theo state scene.
- [ ] Hoán đổi qua kéo-thả cập nhật đồng thời dải và mesh 3D trong một frame kế tiếp, đồng thời giữ nguyên cấu hình đó cho tới thao tác tiếp theo của người dùng.
- [ ] Với tất cả 720 hoán vị của sáu block, code sinh ra đưa block về thứ tự P1–P6 và để P7 trống.
- [ ] Code sinh ra chạy thành công qua `/api/python/run`, không có lệnh live/bridge.

---

## Out of Scope

- Điều khiển robot thật, kết nối live bridge hoặc gửi chương trình vào controller FAIRINO.
- Va chạm vật lý, path planning 3D hoặc tối ưu số bước tối thiểu.
- Sinh đề ngẫu nhiên, Reset về đề cố định và chấm điểm học sinh.

---

## Assumptions

- Thứ tự đích là thứ tự màu block đang định nghĩa cho P1 đến P6.
- Người dùng chấp nhận kéo-thả để đổi bài toán; code mẫu là nội dung hướng dẫn được render khi bài tập khởi tạo.
- P7 chỉ là buffer trong simulator và không đại diện một block thứ bảy.
