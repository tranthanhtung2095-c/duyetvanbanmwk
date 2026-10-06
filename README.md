# Extension Chrome: đẩy văn bản đến lên Ban Tổng giám đốc

## Cài đặt
1. Mở `chrome://extensions`, bật **Chế độ nhà phát triển**.
2. Bấm **Tải tiện ích đã giải nén**, chọn thư mục `med-extension` (giải nén zip trước).
3. Bấm biểu tượng extension, chọn **Cài đặt**:
   - Địa chỉ trang Văn bản đến đã điền sẵn (medworking.medlatec.vn/document/incoming).
   - Chọn DeepSeek hoặc Claude và nhập API key tương ứng.
4. Bấm **Lưu**.

## Cách chạy
- **Tự chạy mỗi 30 phút** (đổi số phút hoặc tắt trong Cài đặt, mục 3; tối thiểu 10 phút). Mỗi lượt mở một cửa sổ MEDworking, quét tab Chờ duyệt, đẩy văn bản mới, xong thì tự đóng cửa sổ. Chỉ hiện thông báo khi có văn bản mới được xử lý hoặc gặp sự cố (ví dụ MEDworking hết phiên đăng nhập).
- Điều kiện: Chrome đang mở, máy không ngủ, tài khoản MEDworking vẫn đăng nhập trong Chrome.
- Lượt tự chạy không xử lý lại văn bản đã đẩy, đã bỏ qua hoặc đã lỗi 3 lần ở các lượt trước. Muốn thử lại thì bấm **Bắt đầu đẩy**.
- Bấm biểu tượng extension, chọn **Bắt đầu đẩy** để chạy ngay.
- Extension đẩy liên tục: xử lý xong danh sách thì quét lại tab Chờ duyệt, còn văn bản mới thì đẩy tiếp, đến khi không còn văn bản nào mới thì dừng và báo kết quả. Văn bản bị bỏ qua hoặc lỗi nằm lại trong Chờ duyệt để xử lý thủ công, không bị thử lại vô hạn.
- Bấm **Dừng** để dừng giữa chừng.
- Chỉ đẩy văn bản tạo trong 6 tháng gần đây (đổi số tháng trong Cài đặt, mục 3). Trước khi quét, extension điền ô "Ngày tạo" trên trang (từ ngày cách đây 6 tháng đến hôm nay) rồi bấm Tìm kiếm. Ngày lấy từ mã văn bản (VB24092026-… là 24/09/2026), không có thì lấy cột Ngày tạo.

## Rà soát kết quả
Mọi văn bản đã xử lý (đã đẩy, chạy thử, bỏ qua, lỗi) được lưu vào lịch sử qua các lượt chạy. Trong popup bấm **Xuất Excel rà soát** để tải file .xlsx gồm:
- Sheet "Rà soát": mã, tên, đơn vị, người nhận AI chọn, lý do, trích nội dung; 3 cột tô vàng để điền **Đánh giá (Đúng/Sai)**, **Người nhận đúng (mã)**, **Góp ý**.
- Sheet "Quy luật đang dùng" và "Thành viên" tại thời điểm xuất.
Điền xong gửi lại file để chỉnh quy luật cho lần sau. **Xóa lịch sử** để bắt đầu đợt rà soát mới.

Mỗi văn bản trong tab Chờ duyệt: đọc nội dung, AI chọn thành viên BTGĐ liên quan, bấm Duyệt văn bản, chọn người nhận, bấm Đồng ý, chờ chuyển, bấm Thoát về danh sách. Sau cùng đối chiếu danh sách để xác nhận văn bản đã rời tab Chờ duyệt.

## Luồng duyệt theo Ma trận thẩm quyền
Người nhận được xác định theo **Ma trận thẩm quyền (Authority Matrix) toàn Tập đoàn** (file `Chuan_hoa_Tu_viet_tat_RACI_TCCB_MEDVN.xlsx`). Mỗi lần phân loại, AI nhận:
1. Quy luật phân công (Cài đặt, mục 4): khối phụ trách của từng thành viên BTGĐ ("BTGĐ khối"), cách đọc ma trận, và các quy tắc bổ sung (chi nhánh ngoài Hà Nội thêm PTGĐ Hùng; PTGĐ Linh chỉ nhận việc của Khối Tài chính Kế toán hoặc dòng ma trận ghi tên; khám sức khoẻ luôn có PTGĐ Quyết; danh sách miễn giảm; cấp quyền phần mềm).
2. Ma trận thẩm quyền rút gọn từ sheet "Authority Matrix - Toàn TĐ": với mỗi hạng mục và phạm vi, ai ở cột BTGĐ/TGĐ/HĐQT, hoặc cấp nào phê chuẩn khi không cần trình BTGĐ.
3. Bảng từ viết tắt (sheet "Từ viết tắt", mục A-D).

Người nhận là mọi thành viên BTGĐ có vai trò Duyệt hoặc Phê chuẩn ở dòng ma trận khớp với văn bản; "BTGĐ khối" là người phụ trách khối của đơn vị đề xuất (đề xuất nhân sự: khối nơi CBNV làm việc). Văn bản mà ma trận cho phê chuẩn ở cấp dưới (ví dụ HĐ thử việc cấp nhân viên do Trưởng Ban TCCB ký theo uỷ quyền) được **bỏ qua** với lý do "Không cần trình BTGĐ theo ma trận thẩm quyền", để xử lý thủ công; không dùng người nhận mặc định cho các văn bản này.

**Theo dõi chi phí AI**: sau mỗi lần gọi, extension ghi số token API trả về (đầu vào không cache, đọc cache, ghi cache, đầu ra). Popup hiện tổng của lượt chạy và của cả lịch sử; file Excel rà soát có cột token và chi phí ước tính từng văn bản. Tiền = token × giá nhập trong Cài đặt, mục 2 (USD / 1 triệu token; giá DeepSeek để 0 thì chỉ hiện token). Số liệu chính xác nhất vẫn là trang Usage trên platform.deepseek.com.

**Cập nhật ma trận** khi có file Excel mới (cần Python): `pip install openpyxl` rồi `python3 tools/build_matrix.py "<đường dẫn file .xlsx>"`. Lệnh ghi lại `authority-matrix.js`; tải lại extension để áp dụng.

**Chi phí AI**: ma trận làm mỗi lần gọi AI dài thêm khoảng vài chục nghìn token. Với Claude, phần này được cache (prompt caching) nên các văn bản sau trong cùng lượt chạy chỉ tính giá đọc cache; DeepSeek tự cache phần đầu giống nhau.

## Văn bản Ban Tổng giám đốc đã có ý kiến
Trước khi gọi AI, extension đọc cột bên trái trang chi tiết (Thông tin ý kiến, Lịch sử thao tác) và tìm các ý kiến/thao tác đứng tên thành viên BTGĐ trong danh sách Cài đặt:
- Ý kiến có từ khóa giữ lại (mặc định: không đồng ý, chưa đồng ý, từ chối, không duyệt, chưa duyệt, trả lại, trả về, bổ sung, làm rõ, giải trình; sửa trong Cài đặt, mục 4): văn bản được đánh dấu **BTGĐ giữ lại**, không đẩy và không bị đẩy lại ở các lượt sau. Hiện trong popup và file Excel rà soát để xử lý thủ công. Tên mục "Ý kiến bổ sung" không tính là yêu cầu bổ sung.
- Ý kiến bình thường (đồng ý, đã xem...): văn bản vẫn đẩy bình thường nhưng bỏ người đã cho ý kiến khỏi danh sách người nhận. Nếu AI chỉ chọn đúng những người đã cho ý kiến thì văn bản bị bỏ qua.

Văn bản AI không xác định được người nhận sẽ bị bỏ qua (trừ khi đặt người nhận mặc định trong Cài đặt) và hiện trong báo cáo cuối lượt.

## Lần đầu
Extension viết dựa trên ảnh chụp màn hình, chưa chạy thử trên MEDworking thật. Bật **Chế độ chạy thử** trong Cài đặt, chạy một lượt để xem AI chọn người nhận có đúng không và tool có thao tác được dropdown không, rồi tắt chế độ này.

## Giới hạn
- Chỉ đọc nội dung ở tab "Nội dung văn bản". Nếu nội dung nằm trong "File đính kèm" thì AI chỉ có tên văn bản và thông tin đề xuất.
- Chrome phải đang mở và máy không ngủ trong lúc chạy.
- Giao diện MEDworking đổi thì có thể cần chỉnh lại `content.js`.
