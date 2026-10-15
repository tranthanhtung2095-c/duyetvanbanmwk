importScripts('shared.js', 'authority-matrix.js');

const STALE_MS = 10 * 60 * 1000;

function notify(title, message) {
  chrome.notifications.create({
    type: 'basic',
    iconUrl: 'icons/icon128.png',
    title,
    message
  });
}

async function getRun() {
  const { run } = await chrome.storage.local.get('run');
  return run || null;
}

// ---------- Tự chạy định kỳ ----------
// Cứ autoMinutes phút (mặc định 30) tự mở MEDworking, quét tab Chờ duyệt và đẩy văn bản mới.
// Chrome phải đang mở; hẹn giờ có thể mất khi khởi động lại trình duyệt nên đặt lại ở onStartup.

const AUTO_ALARM = 'auto-run';

async function scheduleAuto() {
  const s = await getSettings();
  const m = Math.max(0, Number(s.autoMinutes) || 0);
  const cur = await chrome.alarms.get(AUTO_ALARM);
  if (!m) {
    if (cur) await chrome.alarms.clear(AUTO_ALARM);
    return;
  }
  if (!cur || cur.periodInMinutes !== m) {
    await chrome.alarms.create(AUTO_ALARM, { delayInMinutes: m, periodInMinutes: m });
  }
}

chrome.alarms.onAlarm.addListener(async alarm => {
  if (alarm.name !== AUTO_ALARM) return;
  const s = await getSettings();
  if (!(Number(s.autoMinutes) > 0)) return;
  await startRun('auto');
});

chrome.storage.onChanged.addListener(changes => {
  if (changes.settings) scheduleAuto();
});

chrome.runtime.onStartup.addListener(scheduleAuto);

// Bản cũ đăng ký content script động: dọn đi khi cài/cập nhật.
chrome.runtime.onInstalled.addListener(async () => {
  try {
    await chrome.scripting.unregisterContentScripts({ ids: ['med-cs'] });
  } catch (e) {}
  await chrome.storage.local.remove('lastRunDate');
  // Tải lại/cập nhật extension giữa một lượt chạy: script trong tab đang chạy đã mất kết nối
  // và tự dừng, nên kết thúc lượt đó để không bị kẹt "Đang chạy" (bấm Bắt đầu đẩy để chạy tiếp).
  const run = await getRun();
  if (run && run.active) {
    run.active = false;
    run.stopped = true;
    run.finishedAt = Date.now();
    run.note = 'Extension được tải lại/cập nhật giữa lượt chạy nên lượt này đã dừng.';
    await chrome.storage.local.set({ run });
    if (run.trigger === 'auto') await closeWindow(run.windowId);
  }
  await getSettings(); // cập nhật quy luật phân công mới cho cài đặt đã lưu
  // Bản 0.5.x có thể đã đánh dấu nhiều văn bản là "bỏ qua" (không cần trình BTGĐ theo ma trận)
  // hoặc lỗi: xoá các mục này khỏi bộ nhớ "đã xử lý" một lần để lượt tự chạy xét lại.
  const { handledResetV043 } = await chrome.storage.local.get('handledResetV043');
  if (!handledResetV043) {
    const { handled = {} } = await chrome.storage.local.get('handled');
    for (const k of Object.keys(handled)) {
      if (handled[k].status === 'skipped' || handled[k].status === 'error') delete handled[k];
    }
    await chrome.storage.local.set({ handled, handledResetV043: true });
  }
  await scheduleAuto();
});

// ---------- Bấm chuột thật qua debugger ----------

const attachedTabs = new Set();

chrome.debugger.onDetach.addListener(source => {
  if (source.tabId != null) attachedTabs.delete(source.tabId);
});

async function ensureDebugger(tabId) {
  if (attachedTabs.has(tabId)) return;
  try {
    await chrome.debugger.attach({ tabId }, '1.3');
  } catch (e) {
    if (!/already attached/i.test(String(e.message || e))) throw e;
  }
  attachedTabs.add(tabId);
}

async function detachDebugger(tabId) {
  if (tabId == null) return;
  attachedTabs.delete(tabId);
  try {
    await chrome.debugger.detach({ tabId });
  } catch (e) {}
}

async function dispatchClick(tabId, x, y) {
  const mouse = (type, extra) =>
    chrome.debugger.sendCommand({ tabId }, 'Input.dispatchMouseEvent', { type, x, y, ...extra });
  await mouse('mouseMoved', { button: 'none', buttons: 0 });
  await mouse('mousePressed', { button: 'left', buttons: 1, clickCount: 1 });
  await mouse('mouseReleased', { button: 'left', buttons: 0, clickCount: 1 });
}

async function trustedClick(tabId, x, y) {
  await ensureDebugger(tabId);
  try {
    await dispatchClick(tabId, x, y);
  } catch (e) {
    // mất kết nối debugger (ví dụ service worker khởi động lại): nối lại một lần
    attachedTabs.delete(tabId);
    await ensureDebugger(tabId);
    await dispatchClick(tabId, x, y);
  }
  return { ok: true };
}

// Gõ chữ và phím thật (dùng cho ô chọn ngày)
async function withDebugger(tabId, fn) {
  await ensureDebugger(tabId);
  try {
    await fn();
  } catch (e) {
    attachedTabs.delete(tabId);
    await ensureDebugger(tabId);
    await fn();
  }
  return { ok: true };
}
function trustedType(tabId, text) {
  return withDebugger(tabId, () => chrome.debugger.sendCommand({ tabId }, 'Input.insertText', { text }));
}
const KEYS = { Enter: 13, Escape: 27, Tab: 9 };
function trustedKey(tabId, key) {
  const code = KEYS[key] || 0;
  const base = { key, code: key, windowsVirtualKeyCode: code, nativeVirtualKeyCode: code };
  return withDebugger(tabId, async () => {
    await chrome.debugger.sendCommand({ tabId }, 'Input.dispatchKeyEvent', {
      type: 'keyDown',
      ...base,
      ...(key === 'Enter' ? { text: '\r', unmodifiedText: '\r' } : {})
    });
    await chrome.debugger.sendCommand({ tabId }, 'Input.dispatchKeyEvent', { type: 'keyUp', ...base });
  });
}

// ---------- Bắt đầu / dừng / kết thúc một lượt chạy ----------

async function closeWindow(windowId) {
  if (windowId == null) return;
  try {
    await chrome.windows.remove(windowId);
  } catch (e) {}
}

async function startRun(trigger) {
  const s = await getSettings();
  if (!s.listUrl) {
    notify('Chưa cấu hình', 'Vào Cài đặt và nhập địa chỉ trang Văn bản đến của MEDworking.');
    return { ok: false, error: 'Chưa nhập địa chỉ trang Văn bản đến (vào Cài đặt).' };
  }
  const key = s.provider === 'claude' ? s.claudeKey : s.provider === 'compat' ? s.compatKey : s.deepseekKey;
  if (!key) {
    const who = s.provider === 'claude' ? 'Claude' : s.provider === 'compat' ? 'nhà cung cấp AI khác' : 'DeepSeek';
    notify('Chưa có API key', 'Vào Cài đặt và nhập API key cho ' + who + '.');
    return { ok: false, error: 'Chưa nhập API key (vào Cài đặt).' };
  }
  const cur = await getRun();
  if (cur && cur.active && Date.now() - cur.updatedAt < STALE_MS) {
    return { ok: false, error: 'Đang có một lượt chạy khác.' };
  }
  // lượt tự chạy trước bị treo: đóng cửa sổ của nó
  if (cur && cur.active && cur.trigger === 'auto') {
    await detachDebugger(cur.tabId);
    await closeWindow(cur.windowId);
  }
  const win = await chrome.windows.create({ url: s.listUrl, focused: true, state: 'maximized' });
  const tab = win.tabs[0];
  try {
    // nối debugger ngay từ đầu để thanh thông báo của Chrome hiện ra trước khi bấm, tránh lệch tọa độ
    await ensureDebugger(tab.id);
  } catch (e) {
    console.warn('Không nối được debugger, dùng cách bấm thông thường:', e);
  }
  const run = {
    active: true,
    trigger,
    dry: !!s.dryRun,
    maxAgeMonths: Number(s.maxAgeMonths) || 0,
    listUrl: s.listUrl,
    tabId: tab.id,
    windowId: win.id,
    startedAt: Date.now(),
    updatedAt: Date.now(),
    items: null,
    current: null
  };
  await chrome.storage.local.set({ run });
  return { ok: true };
}

async function stopRun() {
  const run = await getRun();
  if (run && run.active) {
    run.active = false;
    run.stopped = true;
    run.finishedAt = Date.now();
    await chrome.storage.local.set({ run });
    await detachDebugger(run.tabId);
  }
  return { ok: true };
}

async function finishRun(note, alert) {
  const run = await getRun();
  if (!run) return { ok: true };
  run.active = false;
  run.finishedAt = Date.now();
  run.note = note || '';
  await chrome.storage.local.set({ run });
  await detachDebugger(run.tabId);
  const all = run.items || [];
  const items = all.filter(i => !HIDDEN_STATUS.includes(i.status));
  const c = st => all.filter(i => i.status === st).length;
  const old = c('old') ? ` Không đẩy ${c('old')} văn bản quá ${run.maxAgeMonths} tháng.` : '';
  const ret = c('returned') ? ` ${c('returned')} văn bản BTGĐ không đồng ý/trả lại/yêu cầu bổ sung, không đẩy.` : '';
  const msg = run.dry
    ? `Chạy thử xong: ${c('dry')} văn bản chọn được người nhận, ${c('skipped')} bỏ qua, ${c('error')} lỗi.${ret}${old}`
    : `Đã đẩy ${c('done')}/${items.length} văn bản. Bỏ qua ${c('skipped')}, lỗi ${c('error')}.${ret}${old}`;
  // tự chạy: chỉ báo khi có văn bản mới được xử lý hoặc có sự cố, rồi đóng cửa sổ
  if (run.trigger !== 'auto' || items.length || alert) {
    notify('Đẩy văn bản lên BTGĐ', items.length ? (note ? msg + ' ' + note : msg) : note || msg);
  }
  if (run.trigger === 'auto') await closeWindow(run.windowId);
  return { ok: true };
}

// ---------- Phân loại bằng AI ----------

function buildSystem(s) {
  const list = s.members.map(m => `- ${m.id}: ${m.name}`).join('\n');
  return [
    'Bạn là thư ký của Ban Tổng giám đốc Tập đoàn Med Group (Medlatec). Nhiệm vụ: đọc một văn bản đến và xác định thành viên Ban Tổng giám đốc cần nhận văn bản để xem xét.',
    '',
    'Danh sách thành viên (mã: tên):',
    list,
    '',
    'Quy luật phân công:',
    s.rules,
    '',
    `MA TRẬN THẨM QUYỀN (Authority Matrix) toàn Tập đoàn - nguồn: ${AUTHORITY_MATRIX_SOURCE}.`,
    'Mỗi hạng mục: "- [số] Hạng mục (loại văn bản)", mỗi dòng con: "· phạm vi áp dụng → vai trò ở cột BTGĐ; TGĐ; HĐQT" hoặc "→ KHÔNG trình BTGĐ (cấp phê chuẩn)" hoặc "→ CHƯA RÕ cấp phê chuẩn".',
    AUTHORITY_MATRIX,
    '',
    'TỪ VIẾT TẮT dùng trong Tập đoàn:',
    ABBREVIATIONS,
    '',
    'Yêu cầu:',
    '- Chọn tất cả thành viên liên quan, không chọn người không liên quan.',
    '- Dòng ma trận khớp ghi "KHÔNG trình BTGĐ": vẫn chọn người nhận theo mục B3 của quy luật và đặt "matrixNoBtgd": true.',
    '- Chỉ trả recipients rỗng khi thật sự không đủ cơ sở để xác định ai.',
    '- reason: một câu ngắn bằng tiếng Việt, nêu hạng mục ma trận đã áp dụng (hoặc "không có trong ma trận").',
    '- Chỉ trả về JSON hợp lệ, không thêm chữ nào khác, đúng dạng: {"recipients":["mã",...],"reason":"...","confident":true,"matrixNoBtgd":false}'
  ].join('\n');
}

function buildUser(doc) {
  return [
    `Mã văn bản: ${doc.code}`,
    `Tên văn bản: ${doc.title || ''}`,
    `Người đề xuất: ${doc.proposer || ''}`,
    `Đơn vị đề xuất: ${doc.unit || ''}`,
    `Nhóm văn bản: ${doc.group || ''}`,
    '',
    'Nội dung trang chi tiết văn bản:',
    doc.text || ''
  ].join('\n');
}

// Mỗi lần gọi AI chờ tối đa AI_TIMEOUT_MS: DeepSeek lúc quá tải có thể giữ kết nối rất lâu
// mà không trả lời, trước đây làm lượt chạy đứng mãi ở trạng thái "Chờ".
const AI_TIMEOUT_MS = 90 * 1000;

async function fetchJson(url, opts) {
  let lastErr;
  for (let attempt = 0; attempt < 2; attempt++) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), AI_TIMEOUT_MS);
    let status = 0;
    try {
      const r = await fetch(url, { ...opts, signal: ctrl.signal });
      status = r.status;
      if (r.ok) return await r.json(); // hạn chờ áp dụng cả lúc đọc nội dung trả về
      lastErr = new Error(`HTTP ${r.status}: ${(await r.text()).slice(0, 200)}`);
    } catch (e) {
      // lỗi mạng hoặc quá thời gian chờ
      lastErr = ctrl.signal.aborted
        ? new Error(`AI không phản hồi sau ${AI_TIMEOUT_MS / 1000} giây (nhà cung cấp AI có thể đang quá tải)`)
        : e;
    } finally {
      clearTimeout(timer);
    }
    // lỗi 4xx (trừ 429) là lỗi cấu hình/key/model, không thử lại; còn lại thử lại một lần
    if (status >= 400 && status < 500 && status !== 429) throw lastErr;
    await new Promise(res => setTimeout(res, 2000));
  }
  throw lastErr;
}

// Gọi DeepSeek kiểu stream (nhận từng phần): model "suy nghĩ" có thể cần vài phút với lời nhắc dài,
// nên không dùng hạn chờ cố định. Còn nhận dữ liệu thì chờ tiếp (tối đa AI_TOTAL_MS); im lặng quá
// AI_IDLE_MS thì dừng. Trả về cùng dạng với API thường để phần còn lại dùng chung.
const AI_TOTAL_MS = 5 * 60 * 1000;
const AI_IDLE_MS = 90 * 1000;

async function streamChat(url, headers, body) {
  const ctrl = new AbortController();
  const started = Date.now();
  let lastData = started;
  let why = '';
  let content = '';
  let reasoning = 0;
  let finish = '';
  let model = '';
  const watchdog = setInterval(() => {
    const now = Date.now();
    if (now - started > AI_TOTAL_MS) why = 'total';
    else if (now - lastData > AI_IDLE_MS) why = 'idle';
    if (why) ctrl.abort();
  }, 2000);
  try {
    const r = await fetch(url, { method: 'POST', headers, body: JSON.stringify({ ...body, stream: true }), signal: ctrl.signal });
    if (!r.ok) {
      const e = new Error(`HTTP ${r.status}: ${(await r.text()).slice(0, 200)}`);
      e.status = r.status;
      throw e;
    }
    const reader = r.body.getReader();
    const dec = new TextDecoder();
    let buf = '';
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      lastData = Date.now();
      buf += dec.decode(value, { stream: true });
      let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i).trim();
        buf = buf.slice(i + 1);
        if (!line.startsWith('data:')) continue; // dòng trống, ": keep-alive"
        const payload = line.slice(5).trim();
        if (payload === '[DONE]') continue;
        let j;
        try {
          j = JSON.parse(payload);
        } catch (e) {
          continue;
        }
        if (j.error) throw new Error('AI: ' + String(j.error.message || JSON.stringify(j.error)).slice(0, 200));
        model = j.model || model;
        const c = j.choices && j.choices[0];
        if (!c) continue;
        const d = c.delta || {};
        if (d.reasoning_content) reasoning += d.reasoning_content.length;
        if (d.content) content += d.content;
        if (c.finish_reason) finish = c.finish_reason;
      }
    }
  } catch (e) {
    if (!ctrl.signal.aborted) throw e;
    const secs = Math.round((Date.now() - started) / 1000);
    const state = content ? 'đang trả lời dở' : reasoning ? `model vẫn đang suy nghĩ, đã nghĩ ${reasoning} ký tự` : 'chưa nhận được chữ nào';
    const err = new Error(
      why === 'total'
        ? `AI chưa trả lời xong sau ${secs} giây (${state})`
        : `AI im lặng ${AI_IDLE_MS / 1000} giây (${state}${content || reasoning ? '' : ' - nhà cung cấp AI có thể đang quá tải'})`
    );
    err.timeout = true;
    throw err;
  } finally {
    clearInterval(watchdog);
  }
  return {
    model,
    choices: [{ finish_reason: finish, message: { content, reasoning_content: reasoning ? `(${reasoning} ký tự)` : '' } }],
    usage: { completion_tokens: '?' }
  };
}

// Mô tả ngắn một phản hồi DeepSeek, để ghi vào thông báo lỗi khi câu trả lời rỗng
function describeDeepSeek(data) {
  const c = (data && data.choices && data.choices[0]) || {};
  const m = c.message || {};
  const out = data && data.usage ? data.usage.completion_tokens : '?';
  return `model=${(data && data.model) || '?'}, finish_reason=${c.finish_reason || '?'}, token trả về=${out}` +
    (m.reasoning_content ? ', có phần suy nghĩ' : '');
}

// DeepSeek báo tên model không còn dùng được, kèm danh sách tên hợp lệ:
// "The supported API model names are deepseek-flash, deepseek-v4-pro, but you passed ..."
// Chọn tên có "flash" (rẻ, nhanh), không có thì tên đầu tiên.
function pickSupportedModel(err) {
  const m = String((err && err.message) || '').match(/supported API model names are (.+?),? but you passed/i);
  if (!m) return null;
  const names = m[1].split(',').map(x => x.trim().toLowerCase()).filter(x => /^[a-z0-9.\-]+$/.test(x));
  return names.find(x => x.includes('flash')) || names[0] || null;
}

async function callDeepSeek(s, system, user) {
  if (!s.deepseekKey) throw new Error('Chưa nhập API key DeepSeek');
  // tên model của DeepSeek viết thường; người dùng gõ "Deepseek-..." vẫn dùng được
  let model = (s.deepseekModel || DEFAULTS.deepseekModel).trim().toLowerCase();
  const ask = async (jsonMode, maxTokens) => {
    try {
      return await send(jsonMode, maxTokens);
    } catch (e) {
      const alt = pickSupportedModel(e);
      if (!alt || alt === model) throw e;
      // tên model cũ bị ngừng: chuyển sang tên DeepSeek gợi ý, lưu vào Cài đặt và gọi lại
      console.warn(`[MED-pusher] DeepSeek không nhận model "${model}", chuyển sang "${alt}"`);
      model = alt;
      const { settings } = await chrome.storage.local.get('settings');
      await chrome.storage.local.set({ settings: { ...(settings || {}), deepseekModel: alt } });
      return await send(jsonMode, maxTokens);
    }
  };
  const send = async (jsonMode, maxTokens) => {
    const body = {
      model,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user }
      ],
      ...(jsonMode ? { response_format: { type: 'json_object' } } : {}),
      temperature: 0,
      max_tokens: maxTokens
    };
    const headers = { 'Content-Type': 'application/json', Authorization: 'Bearer ' + s.deepseekKey };
    try {
      return await streamChat('https://api.deepseek.com/chat/completions', headers, body);
    } catch (e) {
      // lỗi mạng, 429, 5xx: thử lại một lần; quá thời gian chờ thì không thử lại (đã chờ đủ lâu)
      if (e.timeout || (e.status && e.status < 500 && e.status !== 429)) throw e;
      await new Promise(res => setTimeout(res, 2000));
      return await streamChat('https://api.deepseek.com/chat/completions', headers, body);
    }
  };
  const contentOf = data => (data.choices?.[0]?.message?.content || '').trim();

  // max_tokens rộng: model "suy nghĩ" tính cả phần suy nghĩ vào giới hạn này, 500 như trước có thể
  // hết trước khi kịp viết câu trả lời. DeepSeek chỉ tính tiền số token thực sự sinh ra.
  let data = await ask(true, 8000);
  let text = contentOf(data);
  if (!text) {
    // Câu trả lời rỗng (chế độ JSON thỉnh thoảng trả rỗng, hoặc hết token): thử lại một lần,
    // không ép JSON và cho nhiều token hơn; lời nhắc vẫn yêu cầu chỉ trả JSON.
    const first = describeDeepSeek(data);
    data = await ask(false, 8000);
    text = contentOf(data);
    if (!text) {
      throw new Error(
        `DeepSeek trả về câu trả lời rỗng 2 lần (${first} | ${describeDeepSeek(data)}). ` +
          'Kiểm tra tên model trong Cài đặt, mục 2.'
      );
    }
  }
  return text;
}

// Nhà cung cấp khác có API tương thích OpenAI (Qwen, Kimi, GLM...): cùng cách gọi stream như
// DeepSeek nhưng không ép chế độ JSON (không phải nhà cung cấp nào cũng hỗ trợ) - lời nhắc đã
// yêu cầu chỉ trả JSON và phần đọc kết quả tự tìm khối {...}.
async function callCompat(s, system, user) {
  const base = String(s.compatBaseUrl || '').trim().replace(/\/+$/, '');
  if (!/^https:\/\//i.test(base)) throw new Error('Chưa nhập địa chỉ API của nhà cung cấp AI (Cài đặt, mục 2).');
  if (!s.compatKey) throw new Error('Chưa nhập API key của nhà cung cấp AI (Cài đặt, mục 2).');
  if (!s.compatModel) throw new Error('Chưa chọn model của nhà cung cấp AI (Cài đặt, mục 2).');
  const origin = new URL(base).origin + '/*';
  if (!(await chrome.permissions.contains({ origins: [origin] }))) {
    throw new Error(`Chưa cấp quyền truy cập ${new URL(base).host}: vào Cài đặt, bấm Lưu và chọn Cho phép.`);
  }
  const url = base + '/chat/completions';
  const headers = { 'Content-Type': 'application/json', Authorization: 'Bearer ' + s.compatKey };
  const body = {
    model: s.compatModel.trim(),
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: user }
    ],
    temperature: 0,
    max_tokens: 4000
  };
  const send = async () => {
    try {
      return await streamChat(url, headers, body);
    } catch (e) {
      // lỗi mạng, 429, 5xx: thử lại một lần; quá thời gian chờ thì không thử lại
      if (e.timeout || (e.status && e.status < 500 && e.status !== 429)) throw e;
      await new Promise(res => setTimeout(res, 2000));
      return await streamChat(url, headers, body);
    }
  };
  let data = await send();
  let text = (data.choices?.[0]?.message?.content || '').trim();
  if (!text) {
    const first = describeDeepSeek(data);
    data = await send();
    text = (data.choices?.[0]?.message?.content || '').trim();
    if (!text) throw new Error(`AI trả về câu trả lời rỗng 2 lần (${first} | ${describeDeepSeek(data)}).`);
  }
  return text;
}

async function callClaude(s, system, user) {
  if (!s.claudeKey) throw new Error('Chưa nhập API key Claude');
  const data = await fetchJson('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': s.claudeKey,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true'
    },
    body: JSON.stringify({
      model: s.claudeModel || 'claude-haiku-4-5-20251001',
      max_tokens: 500,
      temperature: 0,
      // ma trận thẩm quyền làm phần system dài và giống hệt nhau giữa các văn bản: dùng prompt caching
      system: [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }],
      messages: [{ role: 'user', content: user }]
    })
  });
  return (data.content || []).map(b => b.text || '').join('');
}

// Giữ service worker sống trong lúc chờ AI (Chrome có thể tắt service worker đang rảnh,
// làm mất câu trả lời gửi về trang MEDworking)
async function classify(doc) {
  const keepAlive = setInterval(() => chrome.runtime.getPlatformInfo(() => {}), 20000);
  try {
    return await classifyInner(doc);
  } finally {
    clearInterval(keepAlive);
  }
}

async function classifyInner(doc) {
  const s = await getSettings();
  const system = buildSystem(s);
  const user = buildUser(doc);
  const text = s.provider === 'claude'
    ? await callClaude(s, system, user)
    : s.provider === 'compat'
      ? await callCompat(s, system, user)
      : await callDeepSeek(s, system, user);

  const m = text.match(/\{[\s\S]*\}/);
  if (!m) throw new Error('AI trả về dữ liệu không đọc được: ' + text.slice(0, 120));
  let parsed;
  try {
    parsed = JSON.parse(m[0]);
  } catch (e) {
    throw new Error('AI trả về JSON lỗi: ' + text.slice(0, 120));
  }
  const allowed = new Set(s.members.map(x => String(x.id)));
  let recipients = [...new Set((parsed.recipients || []).map(String))].filter(id => allowed.has(id));
  let usedFallback = false;
  if (!recipients.length && s.fallbackIds.length) {
    recipients = s.fallbackIds.filter(id => allowed.has(String(id))).map(String);
    usedFallback = recipients.length > 0;
  }
  return {
    recipients,
    reason: String(parsed.reason || '').slice(0, 300),
    confident: parsed.confident !== false,
    usedFallback,
    // ma trận cho phê chuẩn dưới cấp BTGĐ nhưng văn bản vẫn được đẩy: đánh dấu để rà soát
    matrixNoBtgd: recipients.length > 0 && !usedFallback && parsed.matrixNoBtgd === true
  };
}

// ---------- Nhận tin nhắn từ content script và popup ----------

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  (async () => {
    switch (msg.type) {
      case 'WHOAMI':
        return { tabId: sender.tab ? sender.tab.id : null };
      case 'CLASSIFY':
        return await classify(msg.doc);
      case 'CLICK_AT':
        if (!sender.tab) return { error: 'no tab' };
        return await trustedClick(sender.tab.id, msg.x, msg.y);
      case 'TYPE_TEXT':
        if (!sender.tab) return { error: 'no tab' };
        return await trustedType(sender.tab.id, msg.text);
      case 'KEY':
        if (!sender.tab) return { error: 'no tab' };
        return await trustedKey(sender.tab.id, msg.key);
      case 'START':
        return await startRun('manual');
      case 'STOP':
        return await stopRun();
      case 'FINISH':
        return await finishRun(msg.note, msg.alert);
      default:
        return { error: 'unknown message' };
    }
  })()
    .then(sendResponse)
    .catch(e => sendResponse({ error: String((e && e.message) || e) }));
  return true;
});
