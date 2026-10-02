# Extension Chrome: đẩy văn bản đến lên Ban Tổng giám đốc

## Cài đặt
1. Mở `chrome://extensions`, bật **Chế độ nhà phát triển**.
2. Bấm **Tải tiện ích đã giải nén**, chọn thư mục `med-extension` (giải nén zip trước).
3. Bấm biểu tượng extension, chọn **Cài đặt**:
   - Địa chỉ trang Văn bản đến đã điền sẵn (medworking.medlatec.vn/document/incoming).
   - Chọn DeepSeek hoặc Claude và nhập API key tương ứng.
4. Bấm **Lưu**.

## Cách chạy
- Bấm biểu tượng extension, chọn **Bắt đầu đẩy**. Không còn lịch chạy tự động lúc 8h.
- Extension đẩy liên tục: xử lý xong danh sách thì quét lại tab Chờ duyệt, còn văn bản mới thì đẩy tiếp, đến khi không còn văn bản nào mới thì dừng và báo kết quả. Văn bản bị bỏ qua hoặc lỗi nằm lại trong Chờ duyệt để xử lý thủ công, không bị thử lại vô hạn.
- Bấm **Dừng** để dừng giữa chừng.
- Chỉ đẩy văn bản tạo trong 6 tháng gần đây (đổi số tháng trong Cài đặt, mục 3). Trước khi quét, extension điền ô "Ngày tạo" trên trang (từ ngày cách đây 6 tháng đến hôm nay) rồi bấm Tìm kiếm. Ngày lấy từ mã văn bản (VB24092026-… là 24/09/2026), không có thì lấy cột Ngày tạo.

## Rà soát kết quả
Mọi văn bản đã xử lý (đã đẩy, chạy thử, bỏ qua, lỗi) được lưu vào lịch sử qua các lượt chạy. Trong popup bấm **Xuất Excel rà soát** để tải file .xlsx gồm:
- Sheet "Rà soát": mã, tên, đơn vị, người nhận AI chọn, lý do, trích nội dung; 3 cột tô vàng để điền **Đánh giá (Đúng/Sai)**, **Người nhận đúng (mã)**, **Góp ý**.
- Sheet "Quy luật đang dùng" và "Thành viên" tại thời điểm xuất.
Điền xong gửi lại file để chỉnh quy luật cho lần sau. **Xóa lịch sử** để bắt đầu đợt rà soát mới.

Mỗi văn bản trong tab Chờ duyệt: đọc nội dung, AI chọn thành viên BTGĐ liên quan, bấm Duyệt văn bản, chọn người nhận, bấm Đồng ý, chờ chuyển, bấm Thoát về danh sách. Sau cùng đối chiếu danh sách để xác nhận văn bản đã rời tab Chờ duyệt.

Quy luật phân công (Cài đặt, mục 4): đề xuất nhân sự gửi thành viên BTGĐ phụ trách bộ phận của CBNV được đề xuất; đề xuất cấp quyền phần mềm gửi Tổng giám đốc và Phó tổng giám đốc phụ trách.

Văn bản AI không xác định được người nhận sẽ bị bỏ qua (trừ khi đặt người nhận mặc định trong Cài đặt) và hiện trong báo cáo cuối lượt.

## Lần đầu
Extension viết dựa trên ảnh chụp màn hình, chưa chạy thử trên MEDworking thật. Bật **Chế độ chạy thử** trong Cài đặt, chạy một lượt để xem AI chọn người nhận có đúng không và tool có thao tác được dropdown không, rồi tắt chế độ này.

## Giới hạn
- Chỉ đọc nội dung ở tab "Nội dung văn bản". Nếu nội dung nằm trong "File đính kèm" thì AI chỉ có tên văn bản và thông tin đề xuất.
- Chrome phải đang mở và máy không ngủ trong lúc chạy.
- Giao diện MEDworking đổi thì có thể cần chỉnh lại `content.js`.
