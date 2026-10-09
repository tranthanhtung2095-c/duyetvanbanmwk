// Cấu hình mặc định và hàm dùng chung (background, popup, options)

const DEFAULT_MEMBERS = [
  { id: '807', name: 'Nguyễn Trí Anh' },
  { id: '15', name: 'Nguyễn Duy Hùng' },
  { id: '8', name: 'Nguyễn Văn Quyết' },
  { id: '14', name: 'Phạm Hữu Thưởng' },
  { id: '304', name: 'Nguyễn Thị Kim Len' },
  { id: '7002', name: 'Trần Thị Hà Linh' }
];

// Tăng số này mỗi khi đổi quy luật mặc định: bản cài đặt đã lưu sẽ tự cập nhật quy luật mới.
// 13: phân công theo Ma trận thẩm quyền (authority-matrix.js, gửi kèm sau quy luật này); khác bản
// 0.5 (quy luật 9) ở chỗ không bao giờ bỏ qua văn bản vì ma trận ghi "không trình BTGĐ".
const RULES_VERSION = 13;

const DEFAULT_RULES = `Văn bản đang ở bước Thư ký, cần chọn thành viên Ban Tổng giám đốc (BTGĐ) nhận văn bản theo MA TRẬN THẨM QUYỀN (Authority Matrix) của Tập đoàn ở cuối hướng dẫn. Luồng ký duyệt: Đề xuất → Duyệt (kiểm soát, tham mưu, ký nháy) → Phê chuẩn (ký chính, quyết định cuối cùng). Ma trận là căn cứ chính; khi quy tắc khác mâu thuẫn với một dòng ma trận khớp rõ ràng thì làm theo ma trận.

A. Thành viên BTGĐ và khối phụ trách ("BTGĐ khối"):
- Nguyễn Trí Anh (807) - Tổng giám đốc (TGĐ): Khối Quản trị (Ban TCCB, Ban Pháp chế, Ban Kiểm soát/KSNB, Ban CNTT, TT Chuyển đổi số, TT Marketing, Phòng VH&QLDL, Phòng Kinh doanh số), Med Pharma; quy chế, chính sách nhân sự, tổ chức bộ máy chung toàn Tập đoàn. Ký toàn bộ hợp đồng của Công ty trên toàn quốc, HĐLĐ/thử việc/đào tạo với người lao động, hợp đồng quảng cáo - marketing, hợp đồng CNTT.
- Nguyễn Duy Hùng (15) - PTGĐ: Khối Khách hàng cá nhân (Ban Trải nghiệm khách hàng, Trung tâm Tại nhà toàn quốc, kể cả ở Hà Nội); khám chữa bệnh ngoại tỉnh - hệ thống Bệnh viện/Phòng khám/chi nhánh NGOÀI Hà Nội; hợp đồng gửi mẫu xét nghiệm toàn quốc. KHÔNG phụ trách bệnh viện/phòng khám tại Hà Nội.
- Nguyễn Văn Quyết (8) - PTGĐ: Khối Khách hàng doanh nghiệp (TT KHDN, TT Bảo hiểm thương mại, TT DVKH), Med Campuchia; hợp đồng khám sức khoẻ; hợp đồng KCB/xét nghiệm/gửi mẫu theo đấu thầu, hồ sơ dự thầu.
- Trần Thị Hà Linh (7002) - PTGĐ: Khối Tài chính Kế toán (Ban Tài chính, Ban Ngân quỹ, Ban Kế toán) - tài chính, kế toán, ngân quỹ, ngân hàng.
- Phạm Hữu Thưởng (14) - PTGĐ: Khối Hậu cần - Dự án (Phòng VT-TTB, Phòng Hành chính, Phòng Cung ứng, Phòng Dự án); hợp đồng hậu cần - hành chính, xây dựng, mua bán hàng hoá y tế/ngoài y tế; mua sắm, chi phí thường quy. ("Dự án" ở đây là dự án đầu tư - xây dựng - sửa chữa cơ sở vật chất, KHÔNG gồm "đơn vị dự án"/dự án khách hàng của TT KHDN - các việc đó thuộc Nguyễn Văn Quyết.)
- Nguyễn Thị Kim Len (304) - PTGĐ: Khối Chuyên môn (Phòng Nghiệp vụ Y, Phòng Kế hoạch, Phòng QLCL, Phòng Đào tạo, Phòng Điều dưỡng, Hệ thống Dược); khám chữa bệnh tại Hà Nội - quản lý, điều hành các Bệnh viện/Phòng khám TẠI HÀ NỘI (Med Hồng Hà, Med Ba Đình, Med Thanh Xuân, Med Cầu Giấy...); chuyên môn y (xét nghiệm, chẩn đoán hình ảnh, giải phẫu bệnh, khám bệnh...); hợp tác chuyên môn, liên kết, chuyển giao kỹ thuật.

B. Cách dùng ma trận:
1. Tìm dòng ma trận khớp nhất với văn bản: Ban/Khối, hạng mục, loại văn bản, rồi đến phạm vi (cấp cơ sở hay cấp hệ thống/HO, trong hay ngoài kế hoạch, cấp nhân sự, ngưỡng giá trị...).
2. Người nhận = mọi thành viên BTGĐ có vai trò (Duyệt, Phê chuẩn, Ký chính, Tham mưu) ở cột BTGĐ và cột TGĐ của dòng đó:
   - "BTGĐ khối", "BTGĐ phụ trách", hoặc cột BTGĐ chỉ ghi "Duyệt"/"Phê chuẩn" = thành viên BTGĐ phụ trách khối của ĐƠN VỊ ĐỀ XUẤT (bảng A), hoặc phụ trách theo chức năng của nội dung.
   - Đề xuất nhân sự: "BTGĐ khối" là người phụ trách khối nơi CBNV được đề xuất đang làm việc, KHÔNG phải đơn vị soạn hộ (văn bản do Ban TCCB soạn cho CBNV chuyên môn → 304). Văn bản có CBNV của nhiều khối thì gửi BTGĐ của tất cả các khối đó; đọc kỹ danh sách để không bỏ sót CBNV kế toán, chuyên môn.
   - Ghi tên cụ thể ("PTGĐ Len", "PTGĐ Thưởng", "PTGĐ Linh", "PTGĐ Hùng", "PTGĐ Quyết", "TGĐ") = đúng người đó; điều kiện trong ngoặc phải thoả (ví dụ "PTGĐ Len: Duyệt (với BS)" chỉ khi đối tượng là bác sĩ).
   - Cột TGĐ có vai trò = Nguyễn Trí Anh (807).
   - Chỉ có HĐQT (hoặc Hội đồng lương, Hội đồng KHKT) phê chuẩn mà cột BTGĐ và TGĐ trống = gửi 807 để trình tiếp.
3. Dòng khớp ghi "KHÔNG trình BTGĐ" (phê chuẩn ở đơn vị cơ sở, ngành dọc, Ban/Trung tâm theo giấy uỷ quyền, Ban Ngân quỹ...): văn bản đã đến bước Thư ký nên VẪN PHẢI chọn người nhận - chọn BTGĐ khối của đơn vị đề xuất (bảng A, cộng các quy tắc ở mục C) và đặt "matrixNoBtgd": true để người dùng rà soát lại. KHÔNG được trả recipients rỗng vì lý do này.
4. Văn bản không khớp dòng nào, hoặc dòng khớp ghi "CHƯA RÕ cấp phê chuẩn": gửi BTGĐ phụ trách khối của đơn vị đề xuất hoặc theo chức năng của nội dung (bảng A); liên quan nhiều khối thì gửi tất cả; chi phí từ khoảng 1 tỷ đồng trở lên thì thêm TGĐ (807).
5. Các mục "đề xuất bổ sung" trong ma trận chưa chính thức, chỉ dùng tham khảo khi không có dòng nào khác.

C. Quy tắc bổ sung (áp dụng cùng ma trận):
1. Văn bản do chi nhánh/bệnh viện/phòng khám NGOÀI Hà Nội đề xuất hoặc liên quan đơn vị ngoài Hà Nội: luôn có Nguyễn Duy Hùng (15), ngoài người nhận theo ma trận. Trừ dự trù tài chính (chỉ 7002).
2. Bệnh viện/phòng khám TẠI Hà Nội (Med Hồng Hà/Ba Đình, Med Ba Đình, Med Thanh Xuân, Med Cầu Giấy và các BV/PK MEDLATEC khác ở Hà Nội) KHÔNG phải "chi nhánh" ở mục C1: "BTGĐ khối" của các đơn vị này là Nguyễn Thị Kim Len (304), KHÔNG gửi Nguyễn Duy Hùng. Mua sắm thiết bị, vật tư, sửa chữa thường quy (không phải CNTT) tại đây theo ma trận Khối Hậu cần dự án (Phạm Hữu Thưởng).
3. Dự trù tài chính (tuần/tháng/quý, dự trù kinh phí, kế hoạch dòng tiền) → CHỈ Trần Thị Hà Linh (7002).
4. Phiếu chi trả phí tư vấn/thù lao cộng tác viên (CTV) ngoài kỳ → CHỈ Nguyễn Duy Hùng (15).
5. Danh sách miễn giảm chi phí xét nghiệm/khám chữa bệnh cho khách hàng, CBNV, đối tác cụ thể (ma trận chưa có dữ liệu "mức giảm giá/quà tặng"): gửi TGĐ (807) và PTGĐ đã được báo cáo/cho ý kiến trong văn bản; không nhắc PTGĐ nào thì 807 và BTGĐ khối của đơn vị đề xuất. Chương trình kích cầu giảm/miễn phí dịch vụ tại đơn vị thì theo ma trận.
6. Đề xuất cấp quyền phần mềm, user/mail ngoài khung quy định: gửi TGĐ (807) và PTGĐ phụ trách bộ phận của người được cấp quyền (hoặc theo lĩnh vực phần mềm: kế toán → 7002, xét nghiệm → 304).
7. Chọn đúng và đủ, không thêm người "cho chắc". Không tự thêm TGĐ (807) nếu dòng ma trận không có TGĐ, văn bản không thuộc khối của 807 và không thuộc mục B4, C5, C6.`;

const DEFAULTS = {
  provider: 'deepseek', // 'deepseek' | 'claude'
  deepseekKey: '',
  deepseekModel: 'deepseek-chat',
  claudeKey: '',
  claudeModel: 'claude-haiku-4-5-20251001',
  listUrl: 'https://medworking.medlatec.vn/document/incoming',
  dryRun: false,
  maxAgeMonths: 6, // chỉ đẩy văn bản tạo trong số tháng gần đây
  autoMinutes: 30, // tự chạy mỗi bao nhiêu phút (0 = tắt)
  // ý kiến/thao tác của BTGĐ có các từ này thì giữ văn bản lại, không đẩy
  holdKeywords: ['không đồng ý', 'chưa đồng ý', 'từ chối', 'không duyệt', 'chưa duyệt', 'trả lại', 'trả về', 'bổ sung', 'làm rõ', 'giải trình'],
  fallbackIds: [],
  members: DEFAULT_MEMBERS,
  rules: DEFAULT_RULES
};

// Trạng thái không hiện từng dòng trong popup/thông báo: quá hạn tháng, đã xử lý ở lượt trước
const HIDDEN_STATUS = ['old', 'prev'];

async function getSettings() {
  const { settings } = await chrome.storage.local.get('settings');
  const s = { ...DEFAULTS, ...(settings || {}) };
  // cài đặt lưu từ bản cũ: thay bằng quy luật mặc định mới
  if (settings && (settings.rulesVersion || 1) < RULES_VERSION) {
    s.rules = DEFAULT_RULES;
    s.rulesVersion = RULES_VERSION;
    await chrome.storage.local.set({ settings: { ...settings, rules: DEFAULT_RULES, rulesVersion: RULES_VERSION } });
  }
  return s;
}

