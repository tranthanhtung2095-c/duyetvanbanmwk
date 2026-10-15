const $ = id => document.getElementById(id);

async function load() {
  const s = await getSettings();
  $('listUrl').value = s.listUrl;
  document.querySelector(`input[name=provider][value=${s.provider}]`).checked = true;
  $('deepseekKey').value = s.deepseekKey;
  $('deepseekModel').value = s.deepseekModel;
  $('claudeKey').value = s.claudeKey;
  $('compatBaseUrl').value = s.compatBaseUrl;
  $('compatKey').value = s.compatKey;
  $('compatModel').value = s.compatModel;
  const preset = COMPAT_PRESETS.find(p => p.baseUrl === s.compatBaseUrl);
  $('compatPreset').value = preset ? preset.id : '';
  $('claudeModel').value = s.claudeModel;
  $('dryRun').checked = s.dryRun;
  $('maxAgeMonths').value = s.maxAgeMonths;
  $('autoMinutes').value = s.autoMinutes;
  $('members').value = s.members.map(m => `${m.id} | ${m.name}`).join('\n');
  $('fallbackIds').value = s.fallbackIds.join(', ');
  $('holdKeywords').value = s.holdKeywords.join('\n');
  $('rules').value = s.rules;
  $('matrixInfo').textContent =
    `Sau quy luật này, AI luôn nhận kèm Ma trận thẩm quyền (${AUTHORITY_MATRIX_ROWS} dòng, từ file ${AUTHORITY_MATRIX_SOURCE}) ` +
    'và bảng từ viết tắt. Ma trận đổi thì chạy tools/build_matrix.py với file Excel mới (xem README).';
}

function parseMembers(text) {
  return text
    .split('\n')
    .map(l => l.trim())
    .filter(Boolean)
    .map(l => {
      const [id, ...rest] = l.split('|');
      return { id: id.trim(), name: rest.join('|').trim() };
    })
    .filter(m => m.id && m.name);
}

// 0 = tắt; bật thì tối thiểu 10 phút để không mở cửa sổ liên tục
function autoMinutes(v) {
  const n = parseInt(v, 10) || 0;
  return n <= 0 ? 0 : Math.max(10, n);
}

// Quyền truy cập địa chỉ API của nhà cung cấp khác. Phải gọi ngay trong lúc bấm nút (Chrome chỉ
// cho xin quyền khi người dùng vừa thao tác), nên gọi trước mọi lệnh await khác.
function requestCompatPermission() {
  const base = $('compatBaseUrl').value.trim();
  if (!/^https:\/\//i.test(base)) return Promise.resolve(true);
  return chrome.permissions.request({ origins: [new URL(base).origin + '/*'] });
}

for (const p of COMPAT_PRESETS) {
  const o = document.createElement('option');
  o.value = p.id;
  o.textContent = p.name;
  $('compatPreset').appendChild(o);
}
$('compatPreset').onchange = () => {
  const p = COMPAT_PRESETS.find(x => x.id === $('compatPreset').value);
  if (!p) return;
  $('compatBaseUrl').value = p.baseUrl;
  if (p.model) $('compatModel').value = p.model;
  $('p-compat').checked = true;
};

$('listModels').onclick = async () => {
  const m = $('modelsMsg');
  m.textContent = 'Đang lấy...';
  try {
    const granted = await requestCompatPermission();
    if (!granted) throw new Error('Chưa cho phép truy cập địa chỉ API.');
    const base = $('compatBaseUrl').value.trim().replace(/\/+$/, '');
    if (!/^https:\/\//i.test(base)) throw new Error('Nhập địa chỉ API bắt đầu bằng https://');
    const r = await fetch(base + '/models', { headers: { Authorization: 'Bearer ' + $('compatKey').value.trim() } });
    const text = await r.text();
    if (!r.ok) throw new Error(`HTTP ${r.status}: ${text.slice(0, 150)}`);
    const ids = ((JSON.parse(text).data) || []).map(x => x.id).filter(Boolean).sort();
    $('compatModels').innerHTML = ids.map(id => `<option value="${id.replace(/"/g, '&quot;')}">`).join('');
    m.textContent = ids.length
      ? `API key hợp lệ, có ${ids.length} model. Bấm vào ô Model để chọn: ${ids.slice(0, 12).join(', ')}${ids.length > 12 ? '...' : ''}`
      : 'API key hợp lệ nhưng nhà cung cấp không trả danh sách model - nhập tên model theo hướng dẫn của nhà cung cấp.';
  } catch (e) {
    m.textContent = 'Lỗi: ' + e.message;
  }
};

$('save').onclick = async () => {
  const msg = $('msg');
  msg.textContent = '';
  const permission = $('p-compat').checked ? requestCompatPermission() : Promise.resolve(true);
  try {
    if (!(await permission)) throw new Error('Chưa cho phép truy cập địa chỉ API của nhà cung cấp AI.');
    if ($('p-compat').checked) {
      if (!/^https:\/\//i.test($('compatBaseUrl').value.trim())) throw new Error('Nhập địa chỉ API của nhà cung cấp khác (bắt đầu bằng https://).');
      if (!$('compatModel').value.trim()) throw new Error('Chọn model của nhà cung cấp khác (bấm "Lấy danh sách model").');
    }
    const listUrl = $('listUrl').value.trim();
    if (!/^https?:\/\//i.test(listUrl)) throw new Error('Địa chỉ trang Văn bản đến chưa hợp lệ.');

    const members = parseMembers($('members').value);
    if (!members.length) throw new Error('Danh sách thành viên đang trống.');
    const ids = new Set(members.map(m => m.id));
    const fallbackIds = $('fallbackIds').value
      .split(',')
      .map(x => x.trim())
      .filter(Boolean);
    const bad = fallbackIds.filter(x => !ids.has(x));
    if (bad.length) throw new Error('Mã mặc định không có trong danh sách thành viên: ' + bad.join(', '));

    const settings = {
      listUrl,
      provider: document.querySelector('input[name=provider]:checked').value,
      deepseekKey: $('deepseekKey').value.trim(),
      deepseekModel: $('deepseekModel').value.trim() || DEFAULTS.deepseekModel,
      claudeKey: $('claudeKey').value.trim(),
      compatBaseUrl: $('compatBaseUrl').value.trim().replace(/\/+$/, ''),
      compatKey: $('compatKey').value.trim(),
      compatModel: $('compatModel').value.trim(),
      claudeModel: $('claudeModel').value.trim() || DEFAULTS.claudeModel,
      dryRun: $('dryRun').checked,
      maxAgeMonths: Math.max(0, parseInt($('maxAgeMonths').value, 10) || 0),
      autoMinutes: autoMinutes($('autoMinutes').value),
      members,
      fallbackIds,
      holdKeywords: (() => {
        const k = $('holdKeywords').value.split('\n').map(x => x.trim()).filter(Boolean);
        return k.length ? k : DEFAULTS.holdKeywords;
      })(),
      rules: $('rules').value.trim() || DEFAULT_RULES,
      rulesVersion: RULES_VERSION
    };
    await chrome.storage.local.set({ settings });
    msg.textContent = 'Đã lưu. Nếu đang mở sẵn tab MEDworking thì tải lại tab đó.';
  } catch (e) {
    msg.textContent = 'Lỗi: ' + e.message;
  }
};

$('resetRules').onclick = () => {
  $('rules').value = DEFAULT_RULES;
};

load();
