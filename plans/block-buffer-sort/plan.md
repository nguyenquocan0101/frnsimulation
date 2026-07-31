# Plan: Dải block tương tác và code sắp xếp P7

**Spec:** `plans/block-buffer-sort/spec.md`
**Mode:** Hard (inline fallback; không có tool subagent riêng trong workspace)
**Risk:** normal — thay đổi UI và simulator state nội bộ; không chạm robot, bridge hoặc dữ liệu ngoài.

## Phase Progress

- [x] Phase 1: State and visual strip
- [x] Phase 2: Drag and drop setup
- [x] Phase 3: Generate and run sorting program
- [ ] Phase 4: Polish and regression review

## Scope Challenge

- **Exists?** Scene đã có `state.blocks` và render mesh; dải state cạnh icon Home, kéo-thả và sinh code chưa có.
- **Minimum?** Một dải 7 slot, tái sử dụng state hiện hữu, một nút render code và thuật toán buffer P7.
- **Complexity?** Hard vì có 3 bề mặt cần đồng bộ: state/scene, UI kéo-thả, code generator.

## Spec Quality Check

- **[PASS]** Không còn mục cần làm rõ; P1/P2/P3, điều kiện chấp nhận và tiêu chí đo được đã có.
- **[PASS]** Phạm vi loại trừ robot thật và bridge được nêu rõ.

## Phase 1 — State and visual strip

**Covers:** P1 story 1; FR-01, FR-02.

1. Xác định mapping block màu → slot từ `state.blocks` và tách helper đọc trạng thái hiện hữu.
2. Thêm container dải slot cạnh icon Home trong viewport; style box màu đầy với label P1–P7.
3. Gọi render dải tại mọi điểm hiện đang cập nhật `state.blocks`/mesh 3D.

**Verification:** khởi tạo, grip/release, reset và animation đều phản chiếu đúng sáu block + P7 trống.

## Phase 2 — Drag and drop setup

**Covers:** P1 story 2; P2 story; FR-03, FR-06.

1. Thêm drag/drop accessible cho các slot có block và focus/keyboard fallback tối thiểu.
2. Áp dụng swap/transfer vào cùng state mà scene 3D dùng, sau đó render dải và mesh.
3. Giữ cấu hình kéo-thả hiện tại làm bài tập đang hiển thị; không có Reset về hoán vị cố định.

**Verification:** thử swap P1↔P4 và transfer P3→P7; luôn còn đúng một slot trống, scene/dải trùng nhau và cấu hình kéo-thả không bị tự thay thế.

## Phase 3 — Generate and run sorting program

**Covers:** P1 story 3; FR-04, FR-05.

1. Đặt hoán vị mẫu P1/P3/P4 trong scene với P7 là ô buffer trống.
2. Render lời giải mẫu dạng function/context manager; từng transfer dùng lấy/đặt ở safe height và tương thích runner.
3. Đồng bộ syntax highlight/validation cho lời giải mẫu; không auto-run và không thay code khi người dùng kéo-thả.

**Verification:** gửi code mẫu tới Python runner, replay trong simulator và xác nhận P1–P6 trở về thứ tự màu chuẩn với P7 trống.

## Phase 4 — Polish and regression review

**Covers:** Performance/security requirements.

1. Kiểm tra responsive của viewport và dải không che icon Home hay controls.
2. Kiểm tra không thay đổi trạng thái live/bridge và không có fetch mới.
3. Chạy static check JavaScript/Python, UI smoke test và code review diff.

**Verification:** không console error, update trong frame tiếp theo, và production chỉ còn simulator.

## Risks and mitigations

- **State split:** không tạo một mảng UI riêng; dải đọc/ghi duy nhất `state.blocks`.
- **Code overwrite:** code mẫu chỉ được đặt khi khởi tạo bài tập, không thay đổi sau kéo-thả.
- **Sai hoán vị:** kiểm thử hoán vị P1/P3/P4 được mô tả ngay trong code mẫu.

## Session Notes
<!-- Updated by cook automatically — do not edit manually -->

**Last active:** 2026-07-31 19:xx
**Phase in progress:** phase-04-polish-and-regression-review
**Status:** Phase 3 verified locally; awaiting approval to continue.

### Decisions made this session
- P7 is a visual buffer slot only; no physical seventh block is created in the 3D scene.
- The strip renders from `state.blocks`, the same state used by the 3D mesh.

### Next immediate action
Run final regression review, update documentation and prepare the branch for handoff.
