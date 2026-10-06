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
// 10: quay lại quy luật của bản 0.4.2 (bản 0.5.x đã lưu quy luật số 9 theo ma trận thẩm quyền,
// phải lớn hơn 9 thì cài đặt đã lưu mới được thay lại).
const RULES_VERSION = 10;

const DEFAULT_RULES = `Phân công lĩnh vực:
Nguyễn Trí Anh (807) - Tổng giám đốc: công nghệ thông tin, pháp chế, ban kiểm soát, khối quản trị (tổ chức cán bộ, hành chính...), Med Pharma; quy chế, chính sách nhân sự và tổ chức bộ máy chung toàn tập đoàn; truyền thông, marketing.
Nguyễn Duy Hùng (15) - Phó tổng giám đốc: kinh doanh khách hàng lẻ, các chi nhánh, trung tâm lấy mẫu tại nhà toàn quốc, ban trải nghiệm khách hàng.
Nguyễn Văn Quyết (8) - Phó tổng giám đốc: kinh doanh khách hàng doanh nghiệp (Trung tâm KHDN), Med Campuchia.
Phạm Hữu Thưởng (14) - Phó tổng giám đốc: hậu cần, dự án đầu tư/xây dựng/sửa chữa cơ sở vật chất, mua hàng, cung ứng; mọi việc mua sắm, chi phí thường quy (bất kể giá trị). ("Dự án" ở đây KHÔNG gồm "đơn vị dự án"/dự án khách hàng của Trung tâm KHDN - các việc đó thuộc Nguyễn Văn Quyết.)
Nguyễn Thị Kim Len (304) - Phó tổng giám đốc: chuyên môn y, các bệnh viện, phòng khám, khoa/phòng chuyên môn (xét nghiệm, chẩn đoán hình ảnh, khám bệnh...). Mọi vấn đề chuyên môn y phải qua người này.
Trần Thị Hà Linh (7002) - Phó tổng giám đốc: tài chính, kế toán, ban tài chính; CHỈ nhận các vấn đề tài chính đặc biệt theo Quy tắc 3. KHÔNG nhận mua sắm, chi phí thường quy dù giá trị lớn, KHÔNG nhận chỉ vì văn bản có nhắc đến tiền.

Nguyên tắc chung:
- Chọn đúng và đủ người theo các quy tắc dưới đây, không thêm người "cho chắc".
- KHÔNG tự thêm Tổng giám đốc Nguyễn Trí Anh (807) nếu văn bản không thuộc lĩnh vực của 807 và không thuộc Quy tắc 2, 3 (chi phí từ 1 tỷ), 5, 6.

Quy tắc 1 - Đề xuất nhân sự (nghỉ phép, nghỉ việc, trở lại công tác, đánh giá nhân viên, hết hạn thử việc/hợp đồng, ký/gia hạn hợp đồng, tuyển dụng, điều chuyển, bổ nhiệm, khen thưởng, kỷ luật...):
- Gửi thành viên Ban Tổng giám đốc phụ trách bộ phận mà cán bộ nhân viên (CBNV) được đề xuất đang làm việc, theo bảng phân công ở trên. Ví dụ:
  + CBNV chuyên môn (bác sĩ, kỹ thuật viên, điều dưỡng, CBNV bệnh viện, phòng khám, khoa xét nghiệm, tổ nhận mẫu...) → Nguyễn Thị Kim Len (304).
  + CBNV kinh doanh khách hàng lẻ, chi nhánh, trung tâm tại nhà, trải nghiệm khách hàng → Nguyễn Duy Hùng (15).
  + CBNV kinh doanh khách hàng doanh nghiệp, Med Campuchia → Nguyễn Văn Quyết (8).
  + CBNV hậu cần, dự án, mua hàng, cung ứng → Phạm Hữu Thưởng (14).
  + CBNV tài chính, kế toán (kể cả phòng kế toán chi nhánh) → Trần Thị Hà Linh (7002).
  + CBNV công nghệ thông tin, pháp chế, ban kiểm soát, khối quản trị, marketing, Med Pharma → Nguyễn Trí Anh (807).
- Xác định theo bộ phận của CBNV được đề xuất, KHÔNG theo đơn vị soạn văn bản (văn bản do Ban Tổ chức cán bộ / phòng nhân sự soạn hộ vẫn gửi người phụ trách bộ phận của CBNV đó).
- Chỉ gửi người phụ trách bộ phận đó, không gửi thêm Tổng giám đốc, trừ khi CBNV thuộc bộ phận do Tổng giám đốc phụ trách.
- Một văn bản có CBNV của nhiều bộ phận thì gửi tất cả người phụ trách các bộ phận đó. Ví dụ danh sách gia hạn/ký lại hợp đồng của chi nhánh ngoài Hà Nội có CBNV kinh doanh/tại nhà, chuyên môn (xét nghiệm, bác sĩ) và kế toán → Nguyễn Duy Hùng (15), Nguyễn Thị Kim Len (304) và Trần Thị Hà Linh (7002). Đọc kỹ danh sách để không bỏ sót CBNV kế toán, chuyên môn.
- Khen thưởng, chế độ cho CBNV là đề xuất nhân sự: KHÔNG gửi thêm Phạm Hữu Thưởng chỉ vì có chi phí.
- Đề xuất thay đổi quy chế, chính sách nhân sự, tổ chức bộ máy chung toàn tập đoàn → Nguyễn Trí Anh (807).

Quy tắc 2 - Đề xuất cấp quyền phần mềm (cấp/mở/thay đổi quyền tài khoản, quyền truy cập hệ thống, phần mềm):
- Gửi Tổng giám đốc Nguyễn Trí Anh (807) VÀ Phó tổng giám đốc phụ trách bộ phận của người được cấp quyền (hoặc lĩnh vực của phần mềm, ví dụ phần mềm kế toán → 7002, phần mềm xét nghiệm → 304).
- Nếu người được cấp quyền thuộc bộ phận do Tổng giám đốc phụ trách thì chỉ gửi 807.

Quy tắc 3 - Văn bản có chi phí, tiền (Trần Thị Hà Linh chỉ nhận vấn đề tài chính rất đặc biệt):
- CHỈ gửi Trần Thị Hà Linh (7002) trong các trường hợp sau:
  + Chi phí quá kỳ / thanh toán ngoài kỳ (chi phí, hóa đơn của kỳ trước, quá hạn).
  + Điều chuyển tiền giữa các đơn vị, tài khoản, gửi tiết kiệm, đầu tư tài chính, vay.
  + Nghiệp vụ kế toán thuần: điều chỉnh/hủy hóa đơn, công nợ, hạch toán, thu hồi hoặc điều chỉnh khoản đã chi, thuế. Các văn bản này chỉ gửi 7002 (cộng Nguyễn Duy Hùng nếu thuộc chi nhánh ngoài Hà Nội theo Quy tắc 4), không gửi thêm Tổng giám đốc.
  + Đề xuất nhân sự hoặc cấp quyền phần mềm (user) cho CBNV thuộc khối tài chính, kế toán (theo Quy tắc 1, 2).
- Mua sắm, chi phí thường quy (mua máy móc thiết bị, vật tư, hóa chất, vật dụng; sửa chữa, lắp đặt, xây dựng; xe, bảo hiểm, PCCC, biển bảng, hiệu chuẩn thiết bị, thuê địa điểm, nhập kho; gói thầu, hợp đồng dịch vụ...) → gửi Phạm Hữu Thưởng (14), BẤT KỂ giá trị lớn hay nhỏ. Chỉ thêm người phụ trách lĩnh vực khi văn bản cần ý kiến chuyên môn của lĩnh vực đó (ví dụ mua máy xét nghiệm → thêm 304). KHÔNG gửi Trần Thị Hà Linh chỉ vì số tiền lớn.
- Chi phí rất lớn, từ khoảng 1 tỷ đồng trở lên: gửi thêm Tổng giám đốc Nguyễn Trí Anh (807), ngoài người phụ trách lĩnh vực. Không tự thêm 7002 nếu không thuộc các trường hợp đặc biệt ở trên.
- Chi phí KHÔNG phải mua sắm/hậu cần (khen thưởng, chế độ, ngoại giao, thưởng KPI/SLA, chi phí kinh doanh...) → gửi người phụ trách lĩnh vực theo nội dung, KHÔNG tự thêm Phạm Hữu Thưởng hay Trần Thị Hà Linh.
- Quy tắc này áp dụng cả khi văn bản do Ban tài chính soạn: vẫn xét theo nội dung, không thuộc các trường hợp đặc biệt ở trên thì không gửi 7002.
- Phân vân có nên gửi Trần Thị Hà Linh hay không thì KHÔNG gửi.

Quy tắc 4 - Đề xuất của các chi nhánh ngoài Hà Nội:
- Văn bản do chi nhánh/đơn vị ngoài Hà Nội đề xuất, hoặc liên quan đến chi nhánh ngoài Hà Nội, LUÔN gửi thêm Nguyễn Duy Hùng (15), ngoài những người nhận theo các quy tắc trên.
- Ví dụ: chi nhánh ngoài Hà Nội đề xuất sửa xe, chi phí nhỏ → Phạm Hữu Thưởng (14) và Nguyễn Duy Hùng (15); đề xuất nhân sự cho bác sĩ tại chi nhánh ngoài Hà Nội → Nguyễn Thị Kim Len (304) và Nguyễn Duy Hùng (15).
- Quy tắc này áp dụng cả khi Quy tắc 1 ghi "chỉ gửi người phụ trách bộ phận". Ở quy tắc này xét theo đơn vị đề xuất / nơi phát sinh vấn đề.
- Văn bản của các đơn vị tại Hà Nội không áp dụng quy tắc này.

Quy tắc 5 - Danh sách miễn giảm (miễn giảm chi phí xét nghiệm, khám chữa bệnh, giảm giá, chiết khấu cho khách hàng/CBNV/đối tác...):
- Gửi Tổng giám đốc Nguyễn Trí Anh (807) VÀ Phó tổng giám đốc đã được thông tin / đã cho ý kiến về danh sách đó (người được nhắc tên trong văn bản, ví dụ "đã báo cáo PTGĐ...", "theo chỉ đạo của PTGĐ...", "PTGĐ ... đã đồng ý").
- Nếu văn bản không nhắc tên Phó tổng giám đốc nào thì gửi 807 và Phó tổng giám đốc phụ trách bộ phận đề xuất.

Quy tắc 6 - Đề xuất truyền thông, marketing (văn bản của Trung tâm Marketing/TTMKT; quảng cáo, truyền thông, báo chí, sự kiện quảng bá, tiếp đón đối tác, nội dung mạng xã hội, website, thương hiệu, tài trợ, PR, chương trình khuyến mại quảng bá...):
- CHỈ gửi Tổng giám đốc Nguyễn Trí Anh (807), kể cả khi có phần tổ chức sự kiện, hậu cần, chi phí nhỏ - KHÔNG gửi thêm Phạm Hữu Thưởng.
- Không gửi Trần Thị Hà Linh (7002), trừ các trường hợp tài chính đặc biệt ở Quy tắc 3.

Quy tắc 7 - Khám sức khỏe (văn bản có nội dung khám sức khỏe, KSK, khám định kỳ, khám tuyển... cho CBNV hoặc khách hàng, đơn vị, doanh nghiệp):
- LUÔN gửi Phó tổng giám đốc Nguyễn Văn Quyết (8).
- Từ khoảng 1 tỷ đồng trở lên thì thêm 807 (Quy tắc 3); không gửi 7002 chỉ vì số tiền. Áp dụng Quy tắc 4 nếu thuộc chi nhánh ngoài Hà Nội.
- KHÔNG gửi Phạm Hữu Thưởng chỉ vì có mua dịch vụ khám.

Các văn bản khác: xác định theo nội dung vấn đề; liên quan nhiều lĩnh vực thì gửi tất cả thành viên liên quan.`;

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

