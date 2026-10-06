const $ = id => document.getElementById(id);

async function load() {
  const s = await getSettings();
  $('listUrl').value = s.listUrl;
  document.querySelector(`input[name=provider][value=${s.provider}]`).checked = true;
  $('deepseekKey').value = s.deepseekKey;
  $('deepseekModel').value = s.deepseekModel;
  $('claudeKey').value = s.claudeKey;
  $('claudeModel').value = s.claudeModel;
  $('dryRun').checked = s.dryRun;
  $('maxAgeMonths').value = s.maxAgeMonths;
  $('autoMinutes').value = s.autoMinutes;
  const p = s.prices;
  $('pDsMiss').value = p.deepseek.miss;
  $('pDsHit').value = p.deepseek.hit;
  $('pDsOut').value = p.deepseek.out;
  $('pClIn').value = p.claude.in;
  $('pClWrite').value = p.claude.write;
  $('pClRead').value = p.claude.read;
  $('pClOut').value = p.claude.out;
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

const price = id => Math.max(0, parseFloat($(id).value) || 0);

// 0 = tắt; bật thì tối thiểu 10 phút để không mở cửa sổ liên tục
function autoMinutes(v) {
  const n = parseInt(v, 10) || 0;
  return n <= 0 ? 0 : Math.max(10, n);
}

$('save').onclick = async () => {
  const msg = $('msg');
  msg.textContent = '';
  try {
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
      claudeModel: $('claudeModel').value.trim() || DEFAULTS.claudeModel,
      dryRun: $('dryRun').checked,
      maxAgeMonths: Math.max(0, parseInt($('maxAgeMonths').value, 10) || 0),
      autoMinutes: autoMinutes($('autoMinutes').value),
      prices: {
        deepseek: { miss: price('pDsMiss'), hit: price('pDsHit'), out: price('pDsOut') },
        claude: { in: price('pClIn'), write: price('pClWrite'), read: price('pClRead'), out: price('pClOut') }
      },
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
