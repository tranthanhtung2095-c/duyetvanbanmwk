// Chạy trong trang MEDworking. Máy trạng thái lưu trong chrome.storage.local ("run"),
// nên chạy đúng cả khi trang tải lại hoặc điều hướng kiểu SPA.
(() => {
  if (window.__medPusherLoaded) return;
  window.__medPusherLoaded = true;

  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const norm = s => (s || '').normalize('NFC').replace(/\s+/g, ' ').trim();
  const T = s => norm(s).toLowerCase();
  // bỏ dấu tiếng Việt để so khớp không bị ảnh hưởng bởi lỗi chính tả trên trang
  // (ví dụ trang ghi "Nguời nhận văn bản" thay vì "Người nhận văn bản")
  const fold = s =>
    T(s)
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/đ/g, 'd');

  const send = msg =>
    new Promise(res => {
      try {
        chrome.runtime.sendMessage(msg, r => res(r || {}));
      } catch (e) {
        res({ error: String(e) });
      }
    });

  // ---------- Tiện ích DOM ----------

  function visible(el) {
    if (!el || !el.getBoundingClientRect) return false;
    const r = el.getBoundingClientRect();
    if (r.width <= 0 || r.height <= 0) return false;
    const st = getComputedStyle(el);
    return st.visibility !== 'hidden' && st.display !== 'none';
  }

  async function waitFor(fn, timeout = 15000, step = 250) {
    const t0 = Date.now();
    while (Date.now() - t0 < timeout) {
      try {
        const v = fn();
        if (v) return v;
      } catch (e) {}
      await sleep(step);
    }
    return null;
  }

  function realClick(el) {
    el.scrollIntoView({ block: 'center' });
    for (const t of ['pointerdown', 'mousedown', 'pointerup', 'mouseup']) {
      el.dispatchEvent(new MouseEvent(t, { bubbles: true, cancelable: true, view: window }));
    }
    el.click();
  }

  // Bấm bằng sự kiện chuột "thật" qua giao thức debugger của Chrome
  // (giao diện này bỏ qua cú bấm giả lập bằng JavaScript).
  async function clickPoint(x, y) {
    const res = await send({ type: 'CLICK_AT', x, y });
    return !(res && res.error);
  }
  async function tclick(el) {
    el.scrollIntoView({ block: 'center' });
    await sleep(200);
    const r = el.getBoundingClientRect();
    const ok = await clickPoint(r.left + r.width / 2, r.top + r.height / 2);
    if (!ok) realClick(el);
  }

  function findButton(text, root = document) {
    const t = T(text);
    return [...root.querySelectorAll('button, a, input[type=button], input[type=submit], [role=button]')]
      .filter(visible)
      .find(b => T(b.innerText || b.value) === t);
  }

  function leafmost(list) {
    return list.filter(e => !list.some(o => o !== e && e.contains(o)));
  }

  async function clickTab(prefix) {
    const c = [...document.querySelectorAll('a, li, button, [role=tab], div, span')]
      .filter(visible)
      .filter(e => {
        const t = norm(e.innerText).toLowerCase();
        return t.startsWith(prefix) && t.length <= prefix.length + 6;
      });
    const el = leafmost(c)[0];
    if (el) await tclick(el);
  }

  // ---------- Lưu trạng thái ----------

  async function getRun() {
    const { run } = await chrome.storage.local.get('run');
    return run || null;
  }
  async function saveRun(run) {
    run.updatedAt = Date.now();
    await chrome.storage.local.set({ run });
  }
  async function patchItem(i, patch) {
    const run = await getRun();
    Object.assign(run.items[i], patch);
    await saveRun(run);
    return run;
  }
  // kết thúc xử lý một văn bản (xóa trạng thái trung gian, bỏ con trỏ current)
  async function endItem(i, patch) {
    const run = await getRun();
    Object.assign(run.items[i], patch, { phase: null });
    run.current = null;
    await saveRun(run);
    await logHistory(run, run.items[i]);
    return run;
  }

  // Lịch sử mọi văn bản đã xử lý (qua nhiều lượt chạy), để xuất Excel rà soát
  const HISTORY_MAX = 5000;
  async function logHistory(run, it) {
    if (!['done', 'dry', 'skipped', 'error', 'returned'].includes(it.status)) return;
    await rememberHandled(it);
    try {
      const { history = [] } = await chrome.storage.local.get('history');
      history.push({
        at: Date.now(),
        runAt: run.startedAt,
        dry: !!run.dry,
        code: it.code,
        title: it.title || '',
        date: it.date || '',
        proposer: it.proposer || '',
        unit: it.unit || '',
        group: it.group || '',
        status: it.status,
        recipients: it.recipients || [],
        reason: it.reason || '',
        confident: it.confident,
        usedFallback: !!it.usedFallback,
        error: it.error || it.note || '',
        excerpt: it.excerpt || '',
        usage: it.usage || null
      });
      await chrome.storage.local.set({ history: history.slice(-HISTORY_MAX) });
    } catch (e) {
      console.warn('[MED-pusher] không ghi được lịch sử', e);
    }
  }

  // Nhớ kết quả xử lý mỗi mã văn bản qua các lượt chạy ("handled"), để lượt tự chạy
  // 30 phút/lần không xử lý lại văn bản đã bỏ qua/đã đẩy, và không bao giờ đụng
  // văn bản Ban Tổng giám đốc đã trả lại.
  const HANDLED_KEEP_MS = 365 * 24 * 3600 * 1000;
  const MAX_ERRORS = 3;
  // 2: "returned" chỉ còn là văn bản BTGĐ không đồng ý/trả lại/yêu cầu bổ sung (bản 0.4.0
  // đánh dấu cả văn bản BTGĐ chỉ đồng ý), nên mục "returned" cũ phải được xét lại
  const HANDLED_VERSION = 2;
  async function rememberHandled(it) {
    try {
      const { handled = {} } = await chrome.storage.local.get('handled');
      const h = handled[it.code] || {};
      handled[it.code] = {
        status: it.status,
        v: HANDLED_VERSION,
        at: Date.now(),
        errors: (h.errors || 0) + (it.status === 'error' ? 1 : 0)
      };
      const now = Date.now();
      for (const k of Object.keys(handled)) if (now - handled[k].at > HANDLED_KEEP_MS) delete handled[k];
      await chrome.storage.local.set({ handled });
    } catch (e) {
      console.warn('[MED-pusher] không ghi được danh sách đã xử lý', e);
    }
  }

  const HANDLED_LABEL = { done: 'đã đẩy', dry: 'chạy thử', skipped: 'bỏ qua', error: 'lỗi', returned: 'BTGĐ trả lại' };

  // Văn bản đã xử lý ở lượt trước: đánh dấu "prev" để không xử lý lại.
  // - BTGĐ trả lại: luôn bỏ qua.
  // - Lượt tự chạy: bỏ qua cả văn bản đã đẩy/bỏ qua, văn bản lỗi đủ MAX_ERRORS lần,
  //   văn bản đã chạy thử (khi vẫn ở chế độ chạy thử).
  // - Lượt bấm tay: thử lại mọi văn bản trừ văn bản BTGĐ trả lại.
  async function markHandled(rows, run) {
    const { handled = {} } = await chrome.storage.local.get('handled');
    const auto = run.trigger === 'auto';
    for (const r of rows) {
      const h = handled[r.code];
      if (!h || r.status !== 'pending') continue;
      const skip =
        (h.status === 'returned' && h.v >= HANDLED_VERSION) ||
        (auto &&
          (h.status === 'done' ||
            h.status === 'skipped' ||
            (h.status === 'dry' && run.dry) ||
            (h.status === 'error' && (h.errors || 0) >= MAX_ERRORS)));
      if (skip) {
        r.status = 'prev';
        r.reason = `Đã xử lý ở lượt trước (${HANDLED_LABEL[h.status] || h.status}), không xử lý lại.`;
      }
    }
    return rows;
  }

  // ---------- Giới hạn thời gian văn bản ----------

  // Ngày tạo văn bản: lấy từ mã văn bản MEDworking dạng ngày-tháng-năm
  // (VB24092026-433 → 24/09/2026); nếu không có thì từ cột Ngày tạo
  function validDate(y, mo, d) {
    return y >= 2000 && y <= 2100 && mo >= 1 && mo <= 12 && d >= 1 && d <= 31 ? new Date(y, mo - 1, d) : null;
  }
  function docDate(r) {
    let m = (r.code || '').match(/VB(\d{8})/);
    if (m) {
      const s = m[1];
      const dmy = validDate(+s.slice(4, 8), +s.slice(2, 4), +s.slice(0, 2)); // DDMMYYYY
      if (dmy) return dmy;
      const ymd = validDate(+s.slice(0, 4), +s.slice(4, 6), +s.slice(6, 8)); // YYYYMMDD (dự phòng)
      if (ymd) return ymd;
    }
    m = (r.date || '').match(/(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{4})/);
    if (m) return new Date(+m[3], +m[2] - 1, +m[1]);
    return null;
  }
  function cutoffDate(months) {
    const d = new Date();
    d.setMonth(d.getMonth() - months);
    d.setHours(0, 0, 0, 0);
    return d;
  }
  // Văn bản cũ hơn giới hạn: đánh dấu "old" để không đẩy (vẫn giữ trong danh sách để không quét lại)
  function markAge(rows, run) {
    const months = Number(run.maxAgeMonths) || 0;
    if (months <= 0) return rows;
    const cut = cutoffDate(months);
    for (const r of rows) {
      const d = docDate(r);
      if (d && d < cut) {
        r.status = 'old';
        r.reason = 'Văn bản tạo trước ' + cut.toLocaleDateString('vi-VN') + ', không đẩy.';
      }
    }
    return rows;
  }

  // ---------- Nhận diện trang ----------

  function listTable() {
    return [...document.querySelectorAll('table')].find(
      t => visible(t) && /Mã văn bản/.test(t.innerText) && t.querySelector('tbody tr')
    );
  }
  const isList = () => !!listTable();
  const isDetail = () => !!findButton('Duyệt văn bản');
  const isLogin = () => [...document.querySelectorAll('input[type=password]')].some(visible);

  function readRows() {
    const t = listTable();
    if (!t) return [];
    const ths = [...t.querySelectorAll('th')].map(th => norm(th.innerText).toLowerCase());
    const idx = (name, def) => {
      const k = ths.findIndex(x => x.startsWith(name));
      return k >= 0 ? k : def;
    };
    const col = {
      code: idx('mã văn bản', 1),
      title: idx('tên văn bản', 2),
      date: idx('ngày tạo', 5),
      proposer: idx('người đề xuất', 6),
      unit: idx('đơn vị đề xuất', 7),
      group: idx('nhóm vb', 8)
    };
    const rows = [];
    for (const tr of t.querySelectorAll('tbody tr')) {
      const cells = [...tr.children];
      const codeCell = cells[col.code];
      const m = codeCell && codeCell.innerText.match(/VB\d{8}-\d+/);
      if (!m) continue;
      const a = codeCell.querySelector('a');
      const rawHref = a && a.getAttribute('href');
      const href = rawHref && !/^(#|javascript:)/i.test(rawHref) ? a.href : null;
      const txt = i => {
        const c = cells[i];
        return c ? norm(c.getAttribute('title') || c.innerText) : '';
      };
      rows.push({
        code: m[0],
        title: txt(col.title),
        date: txt(col.date),
        proposer: txt(col.proposer),
        unit: txt(col.unit),
        group: txt(col.group),
        href
      });
    }
    return rows;
  }

  function nextBtn() {
    // phân trang kiểu Ant Design: <li class="ant-pagination-next"> (không có chữ, chỉ có mũi tên)
    const antNext = [...document.querySelectorAll('.ant-pagination-next')].find(visible);
    if (antNext) {
      const off = /disabled/i.test(antNext.className) || antNext.getAttribute('aria-disabled') === 'true';
      if (off) return null;
      return antNext.querySelector('button, a') || antNext;
    }
    const c = [
      ...document.querySelectorAll(
        '.pagination li, .paginate_button, [class*=pagination] a, [class*=pagination] button, [class*=paging] a, [class*=pager] a'
      )
    ].filter(visible);
    return c.find(el => {
      const t = norm(el.innerText);
      const dis = /disabled/i.test(el.className + ' ' + (el.parentElement ? el.parentElement.className : ''));
      return !dis && /^(›|»|>|next|sau|tiếp)$/i.test(t);
    });
  }

  // Ô chọn số dòng mỗi trang kiểu Ant Design ("10 / trang"): mở ra và chọn số lớn nhất
  async function setAntPageSize() {
    const changer = [...document.querySelectorAll('.ant-pagination-options-size-changer')].find(visible);
    if (!changer) return;
    const cur = parseInt(norm(changer.innerText), 10) || 0;
    const selector = changer.querySelector('.ant-select-selector') || changer;
    await tclick(selector);
    await sleep(500);
    const opts = [...document.querySelectorAll('.ant-select-dropdown .ant-select-item-option')]
      .filter(visible)
      .map(o => ({ o, n: parseInt(norm(o.innerText), 10) || 0 }))
      .filter(x => x.n > 0)
      .sort((a, b) => b.n - a.n);
    if (opts.length && opts[0].n > cur) {
      await tclick(opts[0].o);
      await sleep(2000);
    } else {
      await tclick(selector); // đóng lại
      await sleep(300);
    }
  }

  let dateFilterOk = null;

  async function setMaxPageSize() {
    const sel = [...document.querySelectorAll('select')].find(s =>
      [...s.options].some(o => ['50', '100'].includes(o.text.trim()))
    );
    if (!sel) {
      await setAntPageSize();
      return;
    }
    const best = [...sel.options]
      .map(o => ({ o, n: parseInt(o.text, 10) || parseInt(o.value, 10) || 0 }))
      .sort((a, b) => b.n - a.n)[0];
    if (best && best.n > 0 && sel.value !== best.o.value) {
      sel.value = best.o.value;
      sel.dispatchEvent(new Event('change', { bubbles: true }));
      await sleep(1800);
    }
  }

  // ---------- Lọc theo ô "Ngày tạo" trên trang danh sách ----------

  const p2 = n => String(n).padStart(2, '0');
  const fmtDMY = d => `${p2(d.getDate())}/${p2(d.getMonth() + 1)}/${d.getFullYear()}`;

  // Ô chọn khoảng ngày nằm cùng hàng, bên phải nhãn "Ngày tạo" (không nhầm với "Ngày hoàn tất duyệt")
  function findCreatedPicker() {
    const label = [...document.querySelectorAll('label, div, span, td')].find(
      e => visible(e) && !e.closest('table') && e.children.length === 0 && T(e.innerText) === 'ngày tạo'
    );
    if (!label) return null;
    const lr = label.getBoundingClientRect();
    const ly = lr.top + lr.height / 2;
    const cands = [...document.querySelectorAll('.ant-picker-range, .ant-picker, [class*=picker], [class*=date]')]
      .filter(visible)
      .filter(e => e.querySelectorAll('input').length >= 2 && !e.closest('table'))
      .map(e => ({ e, r: e.getBoundingClientRect() }))
      .filter(({ r }) => r.left >= lr.right - 5 && Math.abs(r.top + r.height / 2 - ly) < 25)
      .sort((a, b) => a.r.left - b.r.left || a.r.width - b.r.width);
    return cands.length ? cands[0].e : null;
  }

  async function typeInto(input, text) {
    await tclick(input);
    await sleep(250);
    input.focus();
    input.select();
    const r = await send({ type: 'TYPE_TEXT', text });
    if (r && r.error) {
      // không có debugger: đặt giá trị kiểu React rồi phát sự kiện input
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
      setter.call(input, text);
      input.dispatchEvent(new Event('input', { bubbles: true }));
    }
    await sleep(250);
  }

  async function pressKey(key) {
    const r = await send({ type: 'KEY', key });
    if (r && r.error) {
      const el = document.activeElement || document.body;
      const code = { Enter: 13, Escape: 27, Tab: 9 }[key] || 0;
      for (const t of ['keydown', 'keyup'])
        el.dispatchEvent(new KeyboardEvent(t, { key, code: key, keyCode: code, which: code, bubbles: true }));
    }
    await sleep(300);
  }

  async function setCreatedRange(from, to) {
    const pk = findCreatedPicker();
    if (!pk) return false;
    const inputs = () => [...pk.querySelectorAll('input')];
    const [a, b] = inputs();
    if (a.value === from && b.value === to) return true;
    await typeInto(a, from);
    await pressKey('Enter');
    await typeInto(inputs()[1], to);
    await pressKey('Enter');
    await sleep(400);
    // đóng bảng lịch nếu vẫn mở
    if ([...document.querySelectorAll('.ant-picker-dropdown')].some(d => visible(d) && !/hidden/.test(d.className))) {
      await pressKey('Escape');
    }
    const [a2, b2] = inputs();
    return a2.value === from && b2.value === to;
  }

  async function scanAll(months) {
    // đưa bộ lọc về mặc định để lấy đủ mọi nhóm văn bản, đặt khoảng "Ngày tạo"
    // trong số tháng cho phép, bấm Tìm kiếm rồi mở tab Chờ duyệt
    const reset = findButton('Đặt lại');
    if (reset) {
      await tclick(reset);
      await sleep(800);
    }
    if (months > 0) {
      const from = fmtDMY(cutoffDate(months));
      const to = fmtDMY(new Date());
      let ok = await setCreatedRange(from, to);
      if (!ok) ok = await setCreatedRange(from, to); // thử lại một lần
      if (!ok) console.warn('[MED-pusher] không đặt được ô Ngày tạo, chỉ lọc theo mã/ngày trong bảng');
      dateFilterOk = ok;
    }
    const search = findButton('Tìm kiếm');
    if (search) {
      await tclick(search);
      await sleep(1800);
    }
    await clickTab('chờ duyệt');
    await sleep(1500);
    await setMaxPageSize();

    const found = new Map();
    for (let page = 0; page < 50; page++) {
      await waitFor(() => readRows().length > 0, 8000);
      const before = found.size;
      for (const r of readRows()) {
        if (!found.has(r.code)) found.set(r.code, { ...r, status: 'pending' });
      }
      const nb = nextBtn();
      if (!nb || found.size === before) break;
      await tclick(nb);
      await sleep(1500);
    }
    return [...found.values()];
  }

  async function findAnchor(code) {
    const look = () => {
      const t = listTable();
      return t && [...t.querySelectorAll('a')].find(a => norm(a.innerText).includes(code));
    };
    let a = look();
    if (a) return a;
    await setMaxPageSize();
    a = look();
    if (a) return a;
    for (let p = 0; p < 10; p++) {
      const nb = nextBtn();
      if (!nb) break;
      await tclick(nb);
      await sleep(1500);
      a = look();
      if (a) return a;
    }
    return null;
  }

  // ---------- Trang danh sách ----------

  async function handleList(run) {
    // Lượt đầu: quét danh sách
    if (!run.items) {
      const items = await markHandled(markAge(await scanAll(Number(run.maxAgeMonths) || 0), run), run);
      const fresh = await getRun();
      if (!fresh || !fresh.active) return;
      fresh.items = items;
      fresh.dateFilterOk = dateFilterOk;
      fresh.current = null;
      fresh.scannedAt = Date.now();
      await saveRun(fresh);
      if (!items.length) await send({ type: 'FINISH', note: 'Tab Chờ duyệt đang trống, không có văn bản nào để đẩy.' });
      return;
    }

    const i = run.current;
    const cur = i != null ? run.items[i] : null;

    if (cur && cur.status === 'pending') {
      if (cur.phase === 'submitted') {
        // kiểm tra văn bản đã rời tab Chờ duyệt chưa
        const present = readRows().some(r => r.code === cur.code);
        if (!present) {
          await endItem(i, { status: 'done', doneAt: Date.now() });
        } else if ((cur.verifyTries || 0) < 2) {
          await patchItem(i, { verifyTries: (cur.verifyTries || 0) + 1 });
          await sleep(3000);
          location.reload();
        } else {
          await endItem(i, { status: 'error', error: 'Văn bản vẫn còn trong Chờ duyệt sau khi bấm Đồng ý, kiểm tra thủ công.' });
        }
        return;
      }
      if (cur.phase === 'opening') {
        if (Date.now() - (cur.openedAt || 0) < 20000) return; // đang chuyển trang
        await endItem(i, { status: 'error', error: 'Không mở được trang chi tiết văn bản.' });
        return;
      }
      await endItem(i, { status: 'error', error: 'Bị gián đoạn giữa chừng, kiểm tra thủ công.' });
      return;
    }

    // Lấy văn bản kế tiếp
    let next = run.items.findIndex(x => x.status === 'pending');
    if (next < 0) {
      // Đã xử lý hết danh sách đã quét: quét lại tab Chờ duyệt, vì văn bản đã đẩy rời đi
      // thì văn bản ở các trang sau dồn lên. Chỉ thêm văn bản chưa từng xử lý (văn bản bị
      // bỏ qua/lỗi vẫn nằm lại trong Chờ duyệt, không xử lý lại). Hết văn bản mới thì dừng.
      const rows = await markHandled(markAge(await scanAll(Number(run.maxAgeMonths) || 0), run), run);
      const fresh = await getRun();
      if (!fresh || !fresh.active) return;
      const seen = new Set(fresh.items.map(x => x.code));
      const added = rows.filter(r => !seen.has(r.code));
      fresh.rescans = (fresh.rescans || 0) + 1;
      if (!added.length || fresh.rescans > 200) {
        await saveRun(fresh);
        const left = rows.filter(r => r.status !== 'old').length;
        await send({
          type: 'FINISH',
          note: left ? `Tab Chờ duyệt còn ${left} văn bản bị bỏ qua hoặc lỗi, cần xử lý thủ công.` : ''
        });
        return;
      }
      fresh.items.push(...added);
      await saveRun(fresh);
      run = fresh;
      next = run.items.findIndex(x => x.status === 'pending');
    }
    const it = run.items[next];
    const fresh = await getRun();
    if (!fresh || !fresh.active) return;
    fresh.current = next;
    fresh.items[next].phase = 'opening';
    fresh.items[next].openedAt = Date.now();
    await saveRun(fresh);

    if (it.href) {
      location.href = it.href;
      return;
    }
    const a = await findAnchor(it.code);
    if (!a) {
      await endItem(next, { status: 'error', error: 'Không tìm thấy văn bản trong danh sách.' });
      return;
    }
    await tclick(a);
  }

  // ---------- Trang chi tiết ----------

  async function goBack(run) {
    const b = findButton('Thoát');
    if (b) {
      await tclick(b);
      await sleep(1500);
    }
    const ok = await waitFor(() => isList(), 8000);
    if (!ok) location.href = run.listUrl;
  }

  async function extractDoc(it) {
    await waitFor(() => document.body.innerText.length > 800, 10000);
    await sleep(1200);
    let text = document.body.innerText;
    const k = text.indexOf('Thông tin văn bản');
    if (k > 0) text = text.slice(k);
    for (const f of document.querySelectorAll('iframe')) {
      try {
        const t = f.contentDocument && f.contentDocument.body && f.contentDocument.body.innerText;
        if (t && t.length > 50) text += '\n' + t;
      } catch (e) {}
    }
    text = text.replace(/[ \t]+/g, ' ').replace(/\n{2,}/g, '\n').slice(0, 14000);
    return { code: it.code, title: it.title, unit: it.unit, proposer: it.proposer, group: it.group, text };
  }

  // ---------- Văn bản Ban Tổng giám đốc đã trả lại ----------

  // Cột bên trái trang chi tiết ("Thông tin ý kiến", "Lịch sử thao tác"): đi từ mỗi tiêu đề
  // lên thẻ cha lớn nhất chưa chứa tab "Nội dung văn bản" bên phải.
  function leftPanels() {
    const leaves = [...document.querySelectorAll('body *')].filter(e => !e.children.length);
    const tab = leaves.find(e => fold(e.textContent) === 'noi dung van ban');
    const heads = leaves.filter(e => {
      const t = fold(e.textContent);
      return t === 'thong tin y kien' || t === 'lich su thao tac';
    });
    const panels = heads.map(h => {
      let el = h;
      while (el.parentElement && el.parentElement !== document.body) {
        const p = el.parentElement;
        if (tab ? p.contains(tab) : fold(p.textContent).includes('noi dung van ban')) break;
        el = p;
      }
      return el;
    });
    return [...new Set(panels)];
  }

  // Ý kiến / thao tác đứng tên thành viên BTGĐ ở cột bên trái. Mỗi mục (một dòng ý kiến
  // hoặc một dòng lịch sử) là thẻ cha nhỏ nhất chứa mốc thời gian "hh:mm dd/mm/yyyy", nên
  // không lẫn tiêu đề mục ("3. Ý kiến bổ sung") hay ý kiến của người khác.
  // Mục có từ khóa giữ lại (không đồng ý, trả lại, bổ sung...) → hold: giữ văn bản, không đẩy.
  // Mục bình thường (đồng ý, đã xem...) → văn bản vẫn đẩy nhưng không gửi lại người đó.
  const STAMP = /\d{1,2}:\d{2}(:\d{2})?\s+\d{1,2}\/\d{1,2}\/\d{4}/;
  function btgdEntries(panel, members, keywords) {
    const names = members.map(m => ({ m, n: fold(m.name) })).filter(x => x.n);
    const keys = keywords.map(k => ({ k, f: fold(k) })).filter(x => x.f);
    const out = [];
    for (const e of panel.querySelectorAll('*')) {
      if (e.children.length) continue;
      const t = fold(e.textContent);
      if (!t) continue;
      const hit = names.find(x => t.includes(x.n) && t.length <= x.n.length + 20);
      if (!hit) continue;
      let row = e;
      while (row !== panel && row.parentElement && !STAMP.test(row.textContent)) row = row.parentElement;
      if (row === panel) row = e.closest('tr, li') || e.parentElement || e;
      const text = norm(row.innerText || row.textContent).slice(0, 300);
      // "Ý kiến bổ sung" là tên mục/thao tác thêm ý kiến, không phải yêu cầu bổ sung
      const body = fold(text).replace(hit.n, ' ').replace(/y kien bo sung/g, ' ');
      const key = keys.find(x => body.includes(x.f));
      out.push({ member: hit.m, text, hold: !!key, key: key && key.k });
    }
    return out;
  }

  // Nhận diện hộp thoại "Duyệt văn bản". So khớp không dấu vì trang ghi sai chính tả
  // "Nguời nhận văn bản". Ưu tiên khung .ant-modal-content, nếu không có thì từ nút
  // "Đồng ý" đi ngược lên thẻ cha gần nhất có chữ "nhận văn bản" / "cấp duyệt".
  function isApproveModal(el) {
    const f = fold(el.innerText);
    return f.includes('nhan van ban') || f.includes('cap duyet');
  }
  function getModal() {
    const ant = [...document.querySelectorAll('.ant-modal-content, [role=dialog], .modal-content')]
      .filter(visible)
      .filter(isApproveModal);
    if (ant.length) return leafmost(ant)[0];
    const btns = [...document.querySelectorAll('button, a, input[type=button], [role=button]')].filter(
      b => visible(b) && T(b.innerText || b.value) === 'đồng ý'
    );
    for (const b of btns) {
      let el = b.parentElement;
      while (el && el !== document.body) {
        if (isApproveModal(el)) return el;
        el = el.parentElement;
      }
    }
    return null;
  }

  // Ô chọn người nhận: ô rộng nhất trong hộp thoại (ô "cấp duyệt" bên cạnh nhỏ hơn nhiều)
  function recipientSelector(m) {
    return [...m.querySelectorAll('.ant-select-selector')]
      .filter(visible)
      .sort((a, b) => b.getBoundingClientRect().width - a.getBoundingClientRect().width)[0] || null;
  }

  // Thông tin chẩn đoán đính kèm vào thông báo lỗi khi không thấy hộp thoại
  function debugModal(btn) {
    const els = [...document.querySelectorAll('[class*=modal], [class*=dialog], [role=dialog]')]
      .filter(visible)
      .slice(0, 4)
      .map(e => `${e.tagName}.${String(e.className).slice(0, 40)}: ${norm(e.innerText).slice(0, 60)}`);
    const btns = [...document.querySelectorAll('button')]
      .filter(visible)
      .map(b => norm(b.innerText))
      .slice(0, 12)
      .join('|');
    const st = btn ? ` nút Duyệt: disabled=${btn.disabled}, class=${String(btn.className).slice(0, 40)};` : '';
    return ` [debug:${st} ${els.join(' ; ') || 'không có phần tử modal/dialog'} || nút: ${btns}]`;
  }

  function isSelected(id) {
    const m = getModal();
    if (!m) return false;
    return [...m.querySelectorAll('table tbody tr')].some(r =>
      [...r.children].some(c => norm(c.innerText) === id)
    );
  }

  // Dòng tùy chọn trong danh sách xổ xuống ("807 - Nguyễn Trí Anh - Ban Tổng giám đốc")
  function findOption(id) {
    const re = new RegExp('^\\s*' + id + '\\s*-\\s*\\S');
    const c = leafmost(
      [...document.querySelectorAll('li, label, div, span, a, option')].filter(
        el => el.textContent.trim().startsWith(id) && visible(el) && re.test(norm(el.innerText)) && !el.closest('table')
      )
    );
    const inDrop = c.filter(el => el.closest('.ant-select-dropdown'));
    if (inDrop.length) return inDrop[0];
    // ưu tiên dòng có ô tích (loại thẻ đã chọn hiện trong ô)
    const strict = c.filter(el => {
      const li = el.closest('li');
      return li && li.querySelector('input[type=checkbox]');
    });
    return strict[0] || c[c.length - 1] || null;
  }

  function optionChecked(opt) {
    const node = opt.closest('.ant-select-tree-treenode, .ant-select-item-option');
    if (node) {
      return !!(
        node.querySelector('.ant-select-tree-checkbox-checked, .ant-checkbox-checked, input[type=checkbox]:checked') ||
        /checked|selected/.test(node.className)
      );
    }
    const li = opt.closest('li') || opt.parentElement;
    const cb = li && li.querySelector('input[type=checkbox]');
    if (cb) return cb.checked;
    return /selected|checked|active/i.test((li && li.className) || '');
  }

  // Bấm đúng vào điểm giữa ô chọn để thành phần con nhận được sự kiện
  async function openDropdown() {
    const m = getModal();
    if (!m) return;
    const antSel = recipientSelector(m);
    const cands = [...m.querySelectorAll('[class*=select], [class*=dropdown], [class*=multi], [role=combobox], [role=listbox]')]
      .filter(visible)
      .filter(e => e.getBoundingClientRect().width > 250)
      .sort((a, b) => b.getBoundingClientRect().width - a.getBoundingClientRect().width);
    const box = antSel && visible(antSel) ? antSel : cands[0];
    let x, y;
    if (box) {
      const r = box.getBoundingClientRect();
      x = r.left + r.width * 0.5;
      y = r.top + r.height / 2;
    } else {
      // không đoán được class: ô chọn nằm ngay dưới dòng "Hãy chọn cấp duyệt để thêm mới"
      const lab = [...m.querySelectorAll('*')].find(
        e => e.children.length === 0 && T(e.innerText).startsWith('hãy chọn cấp duyệt')
      );
      if (!lab) return;
      const r = lab.getBoundingClientRect();
      const mr = m.getBoundingClientRect();
      x = mr.left + mr.width * 0.5;
      y = r.bottom + 34;
    }
    const ok = await clickPoint(x, y);
    if (!ok) {
      const target = document.elementFromPoint(x, y);
      if (target) realClick(target);
    }
    await sleep(500);
    if (isDropdownOpen()) return;
    // chưa mở: thử bấm vào mũi tên, rồi đến cú bấm giả lập vào ô
    const antWrap = antSel && antSel.closest('.ant-select');
    const arrow = antWrap && antWrap.querySelector('.ant-select-arrow');
    if (arrow && visible(arrow)) {
      await tclick(arrow);
      await sleep(500);
      if (isDropdownOpen()) return;
    }
    if (box) realClick(box);
  }

  function isDropdownOpen() {
    return [...document.querySelectorAll('.ant-select-dropdown')].some(
      d => visible(d) && !/ant-select-dropdown-hidden/.test(d.className)
    );
  }

  function debugDropdown() {
    const m = getModal();
    const rs = m && recipientSelector(m);
    const sel = rs && rs.closest('.ant-select');
    const dd = [...document.querySelectorAll('.ant-select-dropdown')].map(
      d => `${String(d.className).slice(0, 50)} vis=${visible(d)}: ${norm(d.innerText).slice(0, 80)}`
    );
    const rows = [...document.querySelectorAll('.ant-select-dropdown *')]
      .filter(e => e.children.length === 0 && visible(e) && norm(e.innerText))
      .slice(0, 4)
      .map(e => `${e.tagName}.${String(e.className).slice(0, 30)}:${norm(e.innerText).slice(0, 25)}`);
    return ` [debug chọn: select=${sel ? String(sel.className).slice(0, 90) : 'không thấy'}; dropdown=${dd.join(' | ') || 'không có'}; dòng=${rows.join(' ; ') || 'không có'}]`;
  }

  // Bấm vào tiêu đề hộp thoại để ẩn danh sách xổ xuống
  async function closeDropdown() {
    const m = getModal();
    if (!m) return;
    const head = [...m.querySelectorAll('h1, h2, h3, h4, h5, h6, .modal-title, div, span')].find(
      e => visible(e) && !e.closest('button, a') && T(e.innerText) === 'duyệt văn bản'
    );
    if (head) await tclick(head);
  }

  async function selectMember(id) {
    for (let attempt = 0; attempt < 3; attempt++) {
      let opt = findOption(id);
      if (!opt) {
        if (!isDropdownOpen()) await openDropdown();
        opt = await waitFor(() => findOption(id), 10000);
      }
      if (!opt) continue;
      if (optionChecked(opt)) return; // đã tích sẵn, bấm nữa sẽ bỏ tích
      const node = opt.closest('.ant-select-tree-treenode');
      const target = (node && node.querySelector('.ant-select-tree-checkbox')) || opt.closest('li') || opt;
      await tclick(target);
      await sleep(700);
      const again = findOption(id);
      if (again && optionChecked(again)) return;
      if (isSelected(id)) return;
    }
    throw new Error('Không chọn được người nhận mã ' + id + debugDropdown());
  }

  async function closeModalIfAny() {
    const m = getModal();
    if (!m) return;
    const c = findButton('Đóng', m);
    if (c) {
      await tclick(c);
      await waitFor(() => !getModal(), 4000);
    }
  }

  async function pushToRecipients(i, ids, dry) {
    const btn = await waitFor(() => findButton('Duyệt văn bản'), 8000);
    if (!btn) throw new Error('Không thấy nút "Duyệt văn bản".');
    let modal = null;
    for (let k = 0; k < 2 && !modal; k++) {
      await tclick(btn);
      // trang có thể mất vài giây để tải dữ liệu trước khi hiện hộp thoại: chờ lâu, không bấm lại sớm
      modal = await waitFor(getModal, k === 0 ? 25000 : 15000);
    }
    if (!modal) {
      btn.click();
      modal = await waitFor(getModal, 5000);
    }
    if (!modal) throw new Error('Hộp thoại "Duyệt văn bản" không mở.' + debugModal(btn));
    await sleep(700);

    for (const id of ids) await selectMember(id);

    await closeDropdown();
    await sleep(600);
    const okAll = await waitFor(() => ids.every(isSelected), 4000);
    if (!okAll) {
      const missing = ids.filter(id => !isSelected(id));
      throw new Error('Chưa chọn đủ người nhận, thiếu mã: ' + missing.join(', '));
    }

    const m2 = getModal();
    if (dry) {
      await closeModalIfAny();
      await endItem(i, { status: 'dry' });
      return;
    }
    const ok = m2 && findButton('Đồng ý', m2);
    if (!ok) throw new Error('Không thấy nút "Đồng ý".');
    await patchItem(i, { phase: 'submitted', submittedAt: Date.now() });
    await tclick(ok);
    const closed = await waitFor(() => !getModal(), 45000, 500);
    if (!closed) throw new Error('Hộp thoại không đóng sau 45 giây, có thể văn bản chưa chuyển.');
    await sleep(2000);
  }

  async function handleDetail(run) {
    if (run.current == null) return;
    const i = run.current;
    const it = run.items[i];
    if (!it || it.status !== 'pending') return;

    if (it.phase === 'submitted') {
      await goBack(run);
      return;
    }
    if (it.phase !== 'opening') {
      await endItem(i, { status: 'error', error: 'Bị gián đoạn giữa chừng, kiểm tra thủ công.' });
      await goBack(run);
      return;
    }

    try {
      const here = await waitFor(() => document.body.innerText.includes(it.code), 12000);
      if (!here) throw new Error('Trang chi tiết không khớp mã văn bản.');

      const found = await waitFor(() => leftPanels().length, 10000);
      if (!found) {
        throw new Error('Không đọc được phần Thông tin ý kiến / Lịch sử thao tác, không đẩy để tránh đẩy lại văn bản BTGĐ đã trả lại.');
      }
      await sleep(1500); // chờ lịch sử thao tác tải xong
      const s = await getSettings();
      const entries = leftPanels().flatMap(p => btgdEntries(p, s.members, s.holdKeywords));
      const hold = entries.find(x => x.hold);
      if (hold) {
        await endItem(i, {
          status: 'returned',
          reason: `${hold.member.name} (BTGĐ) có ý kiến "${hold.key}", giữ lại không đẩy: ${hold.text}`
        });
        await goBack(run);
        return;
      }
      // BTGĐ đã cho ý kiến bình thường: không gửi lại những người này
      const commented = new Map(entries.map(x => [String(x.member.id), x.member.name]));
      await patchItem(i, { phase: 'classifying' });

      const doc = await extractDoc(it);
      await patchItem(i, { excerpt: doc.text.slice(0, 800) });
      const res = await send({ type: 'CLASSIFY', doc });
      if (res.error) throw new Error('AI: ' + res.error);
      if (res.usage) await patchItem(i, { usage: res.usage }); // số token để theo dõi chi phí AI

      const removed = (res.recipients || []).filter(id => commented.has(String(id)));
      if (removed.length) {
        res.recipients = res.recipients.filter(id => !commented.has(String(id)));
        res.reason = `${res.reason || ''} [Không gửi lại ${removed.map(id => commented.get(String(id))).join(', ')}: đã cho ý kiến.]`.trim();
      }
      if (!res.recipients || !res.recipients.length) {
        await endItem(i, {
          status: 'skipped',
          reason: res.noBtgd
            ? 'Không cần trình BTGĐ theo ma trận thẩm quyền: ' + (res.reason || '')
            : removed.length
              ? res.reason
              : res.reason || 'AI không xác định được người nhận.'
        });
        await goBack(run);
        return;
      }
      await patchItem(i, {
        phase: 'sending',
        recipients: res.recipients,
        reason: res.reason,
        confident: res.confident,
        usedFallback: !!res.usedFallback
      });
      await pushToRecipients(i, res.recipients, run.dry);
      await goBack(run);
    } catch (e) {
      const fresh = await getRun();
      const cur = fresh && fresh.items && fresh.items[i];
      await closeModalIfAny();
      if (cur && cur.phase === 'submitted') {
        // đã bấm Đồng ý, để trang danh sách kiểm tra kết quả
        await patchItem(i, { note: 'Lỗi sau khi bấm Đồng ý: ' + e.message });
      } else {
        await endItem(i, { status: 'error', error: e.message });
      }
      await goBack(run);
    }
  }

  // ---------- Vòng lặp chính ----------

  // Extension vừa được tải lại/cập nhật: script cũ còn sót trong tab mất kết nối với extension,
  // mọi lệnh chrome.* báo "Extension context invalidated". Khi đó dừng hẳn vòng lặp cũ.
  const orphaned = e => !(chrome.runtime && chrome.runtime.id) || /context invalidated/i.test(String((e && e.message) || e || ''));

  let myTabId = null;
  (async function loop() {
    while (true) {
      if (orphaned()) return;
      try {
        const run = await getRun();
        if (run && run.active && Date.now() - run.startedAt < 12 * 3600 * 1000) {
          if (myTabId == null) {
            const me = await send({ type: 'WHOAMI' });
            myTabId = me.tabId != null ? me.tabId : null;
          }
          if (myTabId != null && myTabId === run.tabId) {
            if (isDetail()) await handleDetail(run);
            else if (isList()) await handleList(run);
            else if (isLogin() && Date.now() - run.updatedAt > 20000) {
              await send({
                type: 'FINISH',
                note: 'MEDworking đang ở trang đăng nhập: đăng nhập lại trong Chrome, lượt sau sẽ tự chạy.',
                alert: true
              });
            }
          }
        }
      } catch (e) {
        if (orphaned(e)) return;
        console.error('[MED-pusher]', e);
      }
      await sleep(1500);
    }
  })();
})();
