importScripts('shared.js');

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
  await getSettings(); // cập nhật quy luật phân công mới cho cài đặt đã lưu
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
  const key = s.provider === 'claude' ? s.claudeKey : s.deepseekKey;
  if (!key) {
    notify('Chưa có API key', 'Vào Cài đặt và nhập API key cho ' + (s.provider === 'claude' ? 'Claude' : 'DeepSeek') + '.');
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
    'Yêu cầu:',
    '- Chọn tất cả thành viên liên quan, không chọn người không liên quan.',
    '- Nếu không đủ cơ sở để xác định, trả recipients rỗng.',
    '- Chỉ trả về JSON hợp lệ, không thêm chữ nào khác, đúng dạng: {"recipients":["mã",...],"reason":"một câu ngắn bằng tiếng Việt","confident":true}'
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

async function fetchJson(url, opts) {
  let lastErr;
  for (let attempt = 0; attempt < 2; attempt++) {
    let r;
    try {
      r = await fetch(url, opts);
    } catch (e) {
      // lỗi mạng: thử lại một lần
      lastErr = e;
      await new Promise(res => setTimeout(res, 2000));
      continue;
    }
    if (r.ok) return await r.json();
    const body = (await r.text()).slice(0, 200);
    lastErr = new Error(`HTTP ${r.status}: ${body}`);
    // lỗi 4xx (trừ 429) là lỗi cấu hình/key, không thử lại
    if (r.status !== 429 && r.status < 500) throw lastErr;
    await new Promise(res => setTimeout(res, 2000));
  }
  throw lastErr;
}

async function callDeepSeek(s, system, user) {
  if (!s.deepseekKey) throw new Error('Chưa nhập API key DeepSeek');
  const data = await fetchJson('https://api.deepseek.com/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + s.deepseekKey },
    body: JSON.stringify({
      model: s.deepseekModel || 'deepseek-chat',
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user }
      ],
      response_format: { type: 'json_object' },
      temperature: 0,
      max_tokens: 400
    })
  });
  return data.choices?.[0]?.message?.content || '';
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
      max_tokens: 400,
      temperature: 0,
      system,
      messages: [{ role: 'user', content: user }]
    })
  });
  return (data.content || []).map(b => b.text || '').join('');
}

async function classify(doc) {
  const s = await getSettings();
  const system = buildSystem(s);
  const user = buildUser(doc);
  const text = s.provider === 'claude'
    ? await callClaude(s, system, user)
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
    usedFallback
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
