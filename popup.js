const $ = id => document.getElementById(id);

const LABEL = {
  pending: 'Chờ',
  done: 'Đã đẩy',
  skipped: 'Bỏ qua',
  error: 'Lỗi',
  dry: 'Thử OK',
  old: 'Quá hạn',
  returned: 'BTGĐ giữ lại',
  prev: 'Đã xử lý trước'
};

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

const fmtInt = n => Math.round(n).toLocaleString('vi-VN');
const fmtUsd = n => '$' + (n < 0.01 && n > 0 ? n.toFixed(4) : n.toFixed(2));

// "AI: 12 lần gọi, 800.000 token đầu vào (85% đọc từ cache), 1.200 token đầu ra, ước tính $0.05"
function usageLine(list, prices) {
  const t = sumUsage(list, prices);
  if (!t.calls) return '';
  const input = t.uncached + t.cacheRead + t.cacheWrite;
  const pct = input ? Math.round((t.cacheRead / input) * 100) : 0;
  let line = `AI: ${t.calls} lần gọi, ${fmtInt(input)} token đầu vào (${pct}% đọc từ cache), ${fmtInt(t.output)} token đầu ra`;
  if (t.priced) line += `, ước tính ${fmtUsd(t.cost)}` + (t.priced < t.calls ? ` (${t.priced}/${t.calls} lần có giá)` : '');
  else line += ' (nhập giá trong Cài đặt để ước tính tiền)';
  return line + '.';
}

async function renderHistCount() {
  const { history = [] } = await chrome.storage.local.get('history');
  $('histCount').textContent = `Lịch sử: ${history.length} văn bản`;
  const s = await getSettings();
  $('histUsage').textContent = usageLine(history.map(h => h.usage), s.prices).replace(/^AI:/, 'AI trong lịch sử:');
}

async function renderAuto() {
  const s = await getSettings();
  const m = Number(s.autoMinutes) || 0;
  if (!m) {
    $('auto').textContent = 'Tự chạy: đang tắt (bật trong Cài đặt).';
    return;
  }
  const a = await chrome.alarms.get('auto-run');
  const next = a ? ', lượt tới lúc ' + new Date(a.scheduledTime).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' }) : '';
  $('auto').textContent = `Tự chạy: mỗi ${m} phút${next}.`;
}

async function render() {
  renderHistCount();
  renderAuto();
  const { run } = await chrome.storage.local.get('run');
  const s = await getSettings();
  const names = Object.fromEntries(s.members.map(m => [String(m.id), m.name]));

  if (!run) {
    $('status').textContent = 'Chưa có lượt chạy nào.';
    $('list').innerHTML = '';
    return;
  }
  const all = run.items || [];
  const items = all.filter(i => !HIDDEN_STATUS.includes(i.status)); // quá hạn tháng / đã xử lý lượt trước: không hiện từng dòng
  const c = st => all.filter(i => i.status === st).length;
  const when = new Date(run.startedAt).toLocaleString('vi-VN');
  let line;
  if (run.active) {
    line = `Đang chạy (${run.trigger === 'auto' ? 'tự chạy, ' : ''}bắt đầu ${when}${run.dry ? ', chế độ chạy thử' : ''}): ${items.length - c('pending')}/${items.length || '?'} văn bản.`;
  } else {
    line = `Lượt ${run.trigger === 'auto' ? 'tự chạy' : 'chạy'} ${when}${run.stopped ? ' (đã dừng)' : ''}: đã đẩy ${c('done')}, thử ${c('dry')}, BTGĐ giữ lại ${c('returned')}, bỏ qua ${c('skipped')}, lỗi ${c('error')}, còn lại ${c('pending')}.`;
    if (run.note) line += ' ' + run.note;
  }
  if (c('old')) line += ` Không đẩy ${c('old')} văn bản quá ${run.maxAgeMonths} tháng.`;
  if (c('prev')) line += ` ${c('prev')} văn bản đã xử lý ở lượt trước, không xử lý lại.`;
  if (run.dateFilterOk === false) line += ' Lưu ý: không điền được ô Ngày tạo, đã lọc theo ngày trong mã văn bản.';
  const ul = usageLine(all.map(i => i.usage), s.prices);
  if (ul) line += ' ' + ul;
  $('status').textContent = line;

  $('list').innerHTML = items.length
    ? '<table><thead><tr><th>Mã</th><th>Kết quả</th><th>Người nhận / ghi chú</th></tr></thead><tbody>' +
      items
        .map(i => {
          const who = (i.recipients || []).map(id => names[id] || id).join(', ');
          const note = i.error || i.reason || '';
          return `<tr><td>${esc(i.code)}<div class="why">${esc((i.title || '').slice(0, 40))}</div></td>
            <td><span class="tag ${esc(i.status)}">${LABEL[i.status] || esc(i.status)}</span></td>
            <td>${esc(who)}${who && note ? '<div class="why">' + esc(note) + '</div>' : esc(note)}</td></tr>`;
        })
        .join('') +
      '</tbody></table>'
    : '';
}

$('start').onclick = async () => {
  $('msg').textContent = '';
  const r = await chrome.runtime.sendMessage({ type: 'START' });
  if (!r || !r.ok) $('msg').textContent = (r && r.error) || 'Không bắt đầu được.';
  else window.close();
};
$('stop').onclick = async () => {
  await chrome.runtime.sendMessage({ type: 'STOP' });
  render();
};
$('opts').onclick = () => chrome.runtime.openOptionsPage();

// ---------- Xuất Excel để rà soát kết quả phân loại ----------

const RESULT_LABEL = {
  done: 'Đã đẩy',
  dry: 'Chạy thử (chưa đẩy)',
  skipped: 'Bỏ qua',
  error: 'Lỗi',
  returned: 'BTGĐ không đồng ý/trả lại/bổ sung (không đẩy)'
};

function fmtTime(t) {
  return t ? new Date(t).toLocaleString('vi-VN') : '';
}

function buildReviewWorkbook(history, s) {
  const names = Object.fromEntries(s.members.map(m => [String(m.id), m.name]));
  const columns = [
    { title: 'STT', width: 6 },
    { title: 'Thời gian xử lý', width: 18 },
    { title: 'Mã văn bản', width: 18 },
    { title: 'Tên văn bản', width: 45 },
    { title: 'Ngày tạo', width: 14 },
    { title: 'Người đề xuất', width: 20 },
    { title: 'Đơn vị đề xuất', width: 28 },
    { title: 'Nhóm VB', width: 16 },
    { title: 'Kết quả', width: 16 },
    { title: 'Mã người nhận', width: 14 },
    { title: 'Người nhận AI chọn', width: 30 },
    { title: 'Lý do AI', width: 50 },
    { title: 'AI chắc chắn', width: 10 },
    { title: 'Dùng người nhận mặc định', width: 12 },
    { title: 'Lỗi / ghi chú', width: 35 },
    { title: 'Token đầu vào (không cache)', width: 12 },
    { title: 'Token đọc cache', width: 12 },
    { title: 'Token ghi cache', width: 12 },
    { title: 'Token đầu ra', width: 10 },
    { title: 'Chi phí AI ước tính (USD)', width: 12 },
    { title: 'Trích nội dung văn bản', width: 70 },
    { title: 'Đánh giá (Đúng/Sai)', width: 14, input: true },
    { title: 'Người nhận đúng (mã)', width: 16, input: true },
    { title: 'Góp ý để sửa quy luật', width: 40, input: true }
  ];
  const rows = history
    .slice()
    .reverse()
    .map((h, i) => [
      i + 1,
      fmtTime(h.at),
      h.code,
      h.title,
      h.date,
      h.proposer,
      h.unit,
      h.group,
      (RESULT_LABEL[h.status] || h.status) + (h.dry && h.status !== 'dry' ? ' (chạy thử)' : ''),
      (h.recipients || []).join(', '),
      (h.recipients || []).map(id => names[id] || id).join(', '),
      h.reason,
      ['skipped', 'error', 'returned'].includes(h.status) ? '' : h.confident === false ? 'Không' : 'Có',
      h.usedFallback ? 'Có' : '',
      h.error,
      h.usage ? h.usage.uncached || 0 : '',
      h.usage ? h.usage.cacheRead || 0 : '',
      h.usage ? h.usage.cacheWrite || 0 : '',
      h.usage ? h.usage.output || 0 : '',
      (c => (c == null ? '' : Math.round(c * 1e6) / 1e6))(usageCost(h.usage, s.prices)),
      h.excerpt,
      '',
      '',
      ''
    ]);
  const sheets = [
    { name: 'Rà soát', columns, rows },
    {
      name: 'Quy luật đang dùng',
      columns: [{ title: `Quy luật phân công tại thời điểm xuất (${fmtTime(Date.now())})`, width: 140 }],
      rows: s.rules.split('\n').map(l => [l])
    },
    {
      name: 'Thành viên',
      columns: [
        { title: 'Mã', width: 10 },
        { title: 'Tên', width: 30 }
      ],
      rows: s.members.map(m => [m.id, m.name])
    }
  ];
  return XLSX.build(sheets);
}

$('export').onclick = async () => {
  $('msg').textContent = '';
  const { history = [] } = await chrome.storage.local.get('history');
  if (!history.length) {
    $('msg').textContent = 'Chưa có văn bản nào trong lịch sử để xuất.';
    return;
  }
  const s = await getSettings();
  const blob = buildReviewWorkbook(history, s);
  const d = new Date();
  const p = n => String(n).padStart(2, '0');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `ra-soat-day-van-ban-${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}.xlsx`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  $('msg').textContent = `Đã xuất ${history.length} văn bản.`;
};

$('clearHist').onclick = async () => {
  if (!confirm('Xóa toàn bộ lịch sử văn bản đã xử lý? Nên xuất Excel trước khi xóa.')) return;
  await chrome.storage.local.remove('history');
  renderHistCount();
};

chrome.storage.onChanged.addListener(render);
render();
