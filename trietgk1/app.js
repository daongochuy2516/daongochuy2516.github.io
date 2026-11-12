(function () {
  'use strict';

  const DATA = window.QUIZ_DATA;
  const LETTERS = ['A', 'B', 'C', 'D'];
  const WRONG_KEY = 'triet_wrong';
  const PREF_KEY = 'triet_prefs';

  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  // ---------- Storage helpers ----------
  const store = {
    get(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* ignore */ } },
  };

  // ---------- Flatten data ----------
  const ALL = {};          // key -> question
  const BANKS = {};        // id -> [keys]
  DATA.banks.forEach((b) => {
    BANKS[b.id] = [];
    b.qs.forEach((q) => {
      const key = b.id + ':' + q.n;
      ALL[key] = { key, bank: b.id, bankName: b.name, n: q.n, q: q.q, o: q.o, a: q.a, lock: !!q.k };
      BANKS[b.id].push(key);
    });
  });
  BANKS.all = [].concat(...DATA.banks.map((b) => BANKS[b.id]));

  let wrongSet = new Set(store.get(WRONG_KEY, []).filter((k) => ALL[k]));
  const saveWrong = () => store.set(WRONG_KEY, [...wrongSet]);

  // ---------- Setup state ----------
  const DEFAULT_PREFS = { bank: 'p1', mode: 'practice', count: '40', time: 0, shuffleQ: true, shuffleO: true };
  const prefs = Object.assign({}, DEFAULT_PREFS, store.get(PREF_KEY, {}));
  let setup = { bank: prefs.bank, count: prefs.count, time: prefs.time };

  // ---------- Quiz state ----------
  let S = null;

  // ================= THEME =================
  function effectiveTheme() {
    return document.documentElement.dataset.theme || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
  }

  // Circular reveal: the new theme grows as a circle from the clicked button.
  function withThemeTransition(apply, originEl) {
    const before = effectiveTheme();
    const noMotion = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (!document.startViewTransition || noMotion) { apply(); return; }

    let x = innerWidth / 2, y = innerHeight / 2;
    if (originEl) {
      const r = originEl.getBoundingClientRect();
      x = r.left + r.width / 2;
      y = r.top + r.height / 2;
    }
    const radius = Math.hypot(Math.max(x, innerWidth - x), Math.max(y, innerHeight - y));

    let changed = false;
    const t = document.startViewTransition(() => { apply(); changed = effectiveTheme() !== before; });
    t.ready.then(() => {
      if (!changed) return;
      document.documentElement.animate(
        { clipPath: [`circle(0px at ${x}px ${y}px)`, `circle(${radius}px at ${x}px ${y}px)`] },
        { duration: 325, easing: 'cubic-bezier(.4, 0, .2, 1)', pseudoElement: '::view-transition-new(root)' }
      );
    }).catch(() => { /* transition skipped */ });
  }

  $('themeBtn').addEventListener('click', (e) => {
    const next = effectiveTheme() === 'dark' ? 'light' : 'dark';
    withThemeTransition(() => {
      document.documentElement.dataset.theme = next;
      try { localStorage.setItem('triet_theme', next); } catch (err) { /* ignore */ }
    }, e.currentTarget);
  });

  // ================= HOME =================
  function bankList() {
    const list = DATA.banks.map((b) => ({ id: b.id, name: b.name, desc: b.desc, count: b.qs.length }));
    list.push({ id: 'all', name: 'Tất cả', desc: 'Gộp toàn bộ các phần', count: BANKS.all.length });
    list.push({ id: 'wrong', name: 'Câu đã sai', desc: 'Ôn lại những câu từng làm sai', count: wrongSet.size });
    return list;
  }

  function renderHome() {
    const total = BANKS.all.length;
    $('heroStats').textContent = `${total} câu hỏi · ${DATA.banks.length} bộ đề · đáp án lấy từ tài liệu ôn tập`;

    if (setup.bank === 'wrong' && wrongSet.size === 0) setup.bank = 'p1';
    if (!BANKS[setup.bank] && setup.bank !== 'wrong') setup.bank = 'p1';

    $('bankGrid').innerHTML = bankList().map((b) => `
      <button class="bank-card ${b.id === setup.bank ? 'active' : ''}" data-bank="${b.id}" ${b.count === 0 ? 'disabled' : ''}>
        <h3>${esc(b.name)}</h3>
        <p>${esc(b.desc)}</p>
        <div class="bank-count">${b.count} <small>câu</small></div>
      </button>`).join('');

    document.querySelectorAll('input[name="mode"]').forEach((r) => { r.checked = r.value === prefs.mode; });
    $('shuffleQ').checked = prefs.shuffleQ;
    $('shuffleO').checked = prefs.shuffleO;
    setActiveChip('countChips', 'count', setup.count);
    setActiveChip('timeChips', 'time', String(setup.time));
    updateRange(true);
    updateSetupUI();
  }

  function setActiveChip(groupId, attr, val) {
    document.querySelectorAll(`#${groupId} button`).forEach((b) => b.classList.toggle('active', b.dataset[attr] === val));
  }

  function poolKeys() {
    if (setup.bank === 'wrong') return [...wrongSet];
    return BANKS[setup.bank] || [];
  }

  function updateRange(reset) {
    const single = DATA.banks.some((b) => b.id === setup.bank);
    $('rangeField').classList.toggle('hidden', !single);
    if (!single) return;
    const max = BANKS[setup.bank].length;
    $('rangeFrom').max = max; $('rangeTo').max = max;
    if (reset) { $('rangeFrom').value = 1; $('rangeTo').value = max; }
    $('rangeHint').textContent = `(bộ này có câu 1 – ${max})`;
  }

  function currentMode() { return document.querySelector('input[name="mode"]:checked').value; }

  function filteredPool() {
    let keys = poolKeys();
    if (!$('rangeField').classList.contains('hidden')) {
      const max = keys.length;
      let from = Math.max(1, Math.min(max, parseInt($('rangeFrom').value, 10) || 1));
      let to = Math.max(1, Math.min(max, parseInt($('rangeTo').value, 10) || max));
      if (from > to) [from, to] = [to, from];
      keys = keys.filter((k) => ALL[k].n >= from && ALL[k].n <= to);
    }
    return keys;
  }

  function plannedCount() {
    const pool = filteredPool().length;
    return setup.count === 'all' ? pool : Math.min(pool, parseInt(setup.count, 10));
  }

  function updateSetupUI() {
    const mode = currentMode();
    $('timeField').classList.toggle('hidden', mode !== 'exam');
    const n = plannedCount();
    const bankName = bankList().find((b) => b.id === setup.bank).name;
    const modeName = mode === 'exam' ? 'Thi thử' : 'Luyện tập';
    const t = mode === 'exam' && setup.time ? ` · <b>${setup.time} phút</b>` : '';
    $('startSummary').innerHTML = `<b>${modeName}</b> · ${esc(bankName)} · <b>${n} câu</b>${t}`;
    $('startBtn').disabled = n === 0;
  }

  $('bankGrid').addEventListener('click', (e) => {
    const card = e.target.closest('.bank-card');
    if (!card || card.disabled) return;
    setup.bank = card.dataset.bank;
    document.querySelectorAll('.bank-card').forEach((c) => c.classList.toggle('active', c === card));
    updateRange(true);
    updateSetupUI();
  });
  $('countChips').addEventListener('click', (e) => {
    const b = e.target.closest('button'); if (!b) return;
    setup.count = b.dataset.count; setActiveChip('countChips', 'count', setup.count); updateSetupUI();
  });
  $('timeChips').addEventListener('click', (e) => {
    const b = e.target.closest('button'); if (!b) return;
    setup.time = parseInt(b.dataset.time, 10); setActiveChip('timeChips', 'time', b.dataset.time); updateSetupUI();
  });
  document.querySelectorAll('input[name="mode"]').forEach((r) => r.addEventListener('change', updateSetupUI));
  ['rangeFrom', 'rangeTo'].forEach((id) => $(id).addEventListener('input', updateSetupUI));

  $('startBtn').addEventListener('click', () => {
    const mode = currentMode();
    Object.assign(prefs, { bank: setup.bank, mode, count: setup.count, time: setup.time, shuffleQ: $('shuffleQ').checked, shuffleO: $('shuffleO').checked });
    store.set(PREF_KEY, prefs);
    let keys = filteredPool();
    if (prefs.shuffleQ) keys = shuffle(keys.slice());
    keys = keys.slice(0, plannedCount());
    startQuiz(keys, mode, mode === 'exam' ? setup.time : 0);
  });

  // ================= QUIZ =================
  function shuffle(a) {
    for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
    return a;
  }

  // `order[i]` = index in the source options shown at position i
  function makeItem(key, order) {
    const src = ALL[key];
    return { key, src, order, opts: order.map((i) => src.o[i]), ans: order.indexOf(src.a) };
  }
  function buildItem(key) {
    let order = [0, 1, 2, 3];
    if (prefs.shuffleO && !ALL[key].lock) order = shuffle(order);
    return makeItem(key, order);
  }

  // ---------- Session persistence (survive F5 / closing the tab) ----------
  const SESSION_KEY = 'triet_session';
  const RESULT_KEY = 'triet_result';

  function saveSession() {
    if (!S || S.done) return;
    store.set(SESSION_KEY, {
      v: 1,
      mode: S.mode,
      items: S.items.map((it) => [it.key, it.order]),
      idx: S.idx,
      answers: S.answers,
      skipped: [...S.skipped],
      flags: [...S.flags],
      start: S.start,
      limit: S.limit,
      savedAt: Date.now(),
    });
  }
  function clearSession() { try { localStorage.removeItem(SESSION_KEY); } catch (e) { /* ignore */ } }

  const isPerm = (o) => Array.isArray(o) && o.length === 4 && [0, 1, 2, 3].every((i) => o.includes(i));

  function loadSession() {
    const d = store.get(SESSION_KEY, null);
    if (!d || d.v !== 1 || !Array.isArray(d.items) || !d.items.length) return null;
    if (!d.items.every(([k, o]) => ALL[k] && isPerm(o))) return null;
    const n = d.items.length;
    const okIdx = (i) => Number.isInteger(i) && i >= 0 && i < n;
    const answers = Array.isArray(d.answers) && d.answers.length === n
      ? d.answers.map((a) => (Number.isInteger(a) && a >= 0 && a < 4 ? a : null))
      : new Array(n).fill(null);
    let start = Number(d.start) || Date.now();
    const limit = Number(d.limit) || 0;
    // Timed exam: the clock keeps running while the page is closed (like a real exam).
    // Untimed: only count the time the page was actually open.
    if (!limit && d.savedAt) start = Date.now() - (Number(d.savedAt) - start);
    return {
      mode: d.mode === 'exam' ? 'exam' : 'practice',
      keys: d.items.map(([k]) => k),
      items: d.items.map(([k, o]) => makeItem(k, o)),
      idx: okIdx(d.idx) ? d.idx : 0,
      answers,
      skipped: new Set((d.skipped || []).filter(okIdx)),
      flags: new Set((d.flags || []).filter(okIdx)),
      start,
      limit,
      timerId: null,
      done: false,
    };
  }

  window.addEventListener('pagehide', saveSession);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') saveSession(); });

  function startQuiz(keys, mode, minutes) {
    clearInterval(S && S.timerId);
    S = {
      mode,
      keys: keys.slice(),
      items: keys.map(buildItem),
      idx: 0,
      answers: new Array(keys.length).fill(null),
      skipped: new Set(),
      flags: new Set(),
      start: Date.now(),
      limit: minutes * 60,
      timerId: null,
      done: false,
    };
    try { localStorage.removeItem(RESULT_KEY); } catch (e) { /* ignore */ }
    enterQuiz();
  }

  function enterQuiz() {
    const mode = S.mode;
    const exam = mode === 'exam';
    $('modeBadge').textContent = exam ? 'Thi thử' : 'Luyện tập';
    $('modeBadge').classList.toggle('exam', exam);
    $('flagBtn').classList.toggle('hidden', !exam);
    $('submitBtn').textContent = exam ? 'Nộp bài' : 'Kết thúc';
    $('navigator').classList.toggle('hidden', !exam);
    $('navFab').classList.toggle('hidden', !exam);
    document.querySelector('.quiz-layout').classList.toggle('with-nav', exam);
    $('timer').classList.toggle('hidden', !exam);
    $('liveStats').classList.toggle('hidden', exam);

    if (exam) {
      buildNavGrid();
      tick();
      if (!S) return; // restored exam whose time already ran out → auto-submitted
      S.timerId = setInterval(tick, 1000);
    }
    show('quiz');
    renderQuestion();
  }

  function fmtTime(sec) {
    sec = Math.max(0, Math.round(sec));
    const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
    const mm = String(m).padStart(2, '0'), ss = String(s).padStart(2, '0');
    return h ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
  }

  function tick() {
    const el = (Date.now() - S.start) / 1000;
    if (S.limit) {
      const left = S.limit - el;
      $('timer').textContent = fmtTime(left);
      $('timer').classList.toggle('low', left <= 60);
      if (left <= 0) { finish(true); }
    } else {
      $('timer').textContent = fmtTime(el);
    }
  }

  function renderQuestion() {
    const it = S.items[S.idx];
    const total = S.items.length;
    const exam = S.mode === 'exam';
    const chosen = S.answers[S.idx];
    const skipped = !exam && chosen === null && S.skipped.has(S.idx);
    const revealed = !exam && (chosen !== null || skipped);

    $('counter').textContent = `Câu ${S.idx + 1} / ${total}`;
    $('qNum').textContent = `Câu ${S.idx + 1}`;
    $('qSrc').textContent = `${it.src.bankName} · câu ${it.src.n}`;
    $('qText').textContent = it.src.q;
    $('flagBtn').classList.toggle('on', S.flags.has(S.idx));

    $('options').innerHTML = it.opts.map((o, i) => {
      let cls = 'opt';
      if (exam) { if (chosen === i) cls += ' selected'; }
      else if (revealed) {
        if (i === it.ans) cls += ' correct';
        else if (i === chosen) cls += ' wrong';
        else cls += ' dim';
      }
      return `<button class="${cls}" data-i="${i}" ${revealed ? 'disabled' : ''}><span class="letter">${LETTERS[i]}</span><span>${esc(o)}</span></button>`;
    }).join('');

    // feedback (practice)
    const fb = $('feedback');
    if (skipped) {
      fb.className = 'feedback skip';
      fb.textContent = `Bạn đã bỏ qua câu này — đáp án đúng là ${LETTERS[it.ans]}.`;
    } else if (revealed) {
      const ok = chosen === it.ans;
      fb.className = 'feedback ' + (ok ? 'ok' : 'bad');
      fb.textContent = ok ? '✓ Chính xác!' : `✗ Chưa đúng — đáp án đúng là ${LETTERS[it.ans]}.`;
    } else {
      fb.className = 'feedback hidden';
    }

    // buttons: in practice, "Bỏ qua" until answered, then "Câu tiếp"
    const last = S.idx === total - 1;
    const primaryNext = exam || revealed;
    $('prevBtn').disabled = S.idx === 0;
    $('nextBtn').classList.toggle('hidden', last);
    $('submitBtn').classList.toggle('hidden', !last);
    $('nextBtn').textContent = primaryNext ? 'Câu tiếp →' : 'Bỏ qua →';
    $('nextBtn').classList.toggle('btn-primary', primaryNext);
    $('nextBtn').classList.toggle('btn-ghost', !primaryNext);

    // progress
    const done = exam ? S.answers.filter((a) => a !== null).length : S.answers.filter((a) => a !== null).length + S.skipped.size;
    $('progressFill').style.width = (done / total * 100) + '%';

    if (exam) updateNavGrid();
    else updateLiveStats();

    const card = $('qcard');
    card.style.animation = 'none'; void card.offsetWidth; card.style.animation = '';

    saveSession();
  }

  function updateLiveStats() {
    let ok = 0, bad = 0;
    S.answers.forEach((a, i) => { if (a === null) return; if (a === S.items[i].ans) ok++; else bad++; });
    $('liveStats').innerHTML = `<span class="s-ok">✓ ${ok}</span><span class="s-bad">✗ ${bad}</span><span class="s-skip">↷ ${S.skipped.size}</span>`;
  }

  function choose(i) {
    if (!S || S.done) return;
    const it = S.items[S.idx];
    if (S.mode === 'exam') {
      S.answers[S.idx] = S.answers[S.idx] === i ? null : i;
      renderQuestion();
      return;
    }
    if (S.answers[S.idx] !== null || S.skipped.has(S.idx)) return;
    S.answers[S.idx] = i;
    if (i === it.ans) wrongSet.delete(it.key); else wrongSet.add(it.key);
    saveWrong();
    renderQuestion();
  }

  function go(delta) {
    const n = S.idx + delta;
    if (n < 0 || n >= S.items.length) return;
    S.idx = n;
    renderQuestion();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function next() {
    if (S.mode === 'practice' && S.answers[S.idx] === null) S.skipped.add(S.idx);
    if (S.idx === S.items.length - 1) {
      if (S.mode === 'practice') finish();
      return;
    }
    go(1);
  }

  $('options').addEventListener('click', (e) => {
    const b = e.target.closest('.opt'); if (!b || b.disabled) return;
    choose(parseInt(b.dataset.i, 10));
  });
  $('nextBtn').addEventListener('click', next);
  $('prevBtn').addEventListener('click', () => go(-1));
  $('flagBtn').addEventListener('click', () => {
    if (S.flags.has(S.idx)) S.flags.delete(S.idx); else S.flags.add(S.idx);
    renderQuestion();
  });
  $('submitBtn').addEventListener('click', askSubmit);
  $('submitBtn2').addEventListener('click', askSubmit);
  $('exitBtn').addEventListener('click', () => {
    confirmBox('Thoát bài làm?', 'Tiến độ của lượt làm này sẽ không được lưu.', 'Thoát', () => {
      clearInterval(S.timerId); S = null; clearSession(); goHome();
    });
  });

  function askSubmit() {
    if (S.mode === 'practice') {
      if (S.answers[S.idx] === null && S.idx === S.items.length - 1) S.skipped.add(S.idx);
      finish();
      return;
    }
    const blank = S.answers.filter((a) => a === null).length;
    const flagged = S.flags.size;
    let msg = blank ? `Bạn còn ${blank} câu chưa làm.` : 'Bạn đã làm hết tất cả các câu.';
    if (flagged) msg += ` Có ${flagged} câu đang được đánh dấu.`;
    confirmBox('Nộp bài?', msg + ' Sau khi nộp sẽ không sửa được nữa.', 'Nộp bài', () => finish());
  }

  // ---------- Navigator ----------
  function buildNavGrid() {
    $('navGrid').innerHTML = S.items.map((_, i) => `<button data-i="${i}">${i + 1}</button>`).join('');
  }
  function updateNavGrid() {
    const btns = $('navGrid').children;
    for (let i = 0; i < btns.length; i++) {
      const b = btns[i];
      b.classList.toggle('answered', S.answers[i] !== null);
      b.classList.toggle('flagged', S.flags.has(i));
      b.classList.toggle('current', i === S.idx);
    }
    const cur = btns[S.idx];
    if (cur && cur.scrollIntoView && window.innerWidth > 900) cur.scrollIntoView({ block: 'nearest' });
  }
  $('navGrid').addEventListener('click', (e) => {
    const b = e.target.closest('button'); if (!b) return;
    S.idx = parseInt(b.dataset.i, 10);
    renderQuestion();
    $('navigator').classList.remove('open');
  });
  $('navFab').addEventListener('click', () => $('navigator').classList.toggle('open'));
  // ================= RESULT =================
  let lastResult = null;

  function makeRow(it, chosen) {
    const status = chosen === null ? 'skip' : (chosen === it.ans ? 'right' : 'wrong');
    return { it, chosen, status };
  }

  function finish(timeout) {
    if (!S || S.done) return;
    S.done = true;
    clearInterval(S.timerId);
    const elapsed = (Date.now() - S.start) / 1000;
    const rows = S.items.map((it, i) => makeRow(it, S.answers[i]));
    if (S.mode === 'exam') {
      rows.forEach((r) => {
        if (r.status === 'right') wrongSet.delete(r.it.key);
        else if (r.status === 'wrong') wrongSet.add(r.it.key);
      });
      saveWrong();
    }
    const R = { rows, mode: S.mode, limit: S.limit, elapsed, timeout: !!timeout };
    clearSession();
    store.set(RESULT_KEY, {
      v: 1, mode: R.mode, limit: R.limit, elapsed: R.elapsed, timeout: R.timeout,
      rows: rows.map((r) => [r.it.key, r.it.order, r.chosen]),
    });
    S = null;
    showResult(R);
  }

  function loadResult() {
    const d = store.get(RESULT_KEY, null);
    if (!d || d.v !== 1 || !Array.isArray(d.rows) || !d.rows.length) return null;
    if (!d.rows.every(([k, o]) => ALL[k] && isPerm(o))) return null;
    return {
      mode: d.mode === 'exam' ? 'exam' : 'practice',
      limit: Number(d.limit) || 0,
      elapsed: Number(d.elapsed) || 0,
      timeout: !!d.timeout,
      rows: d.rows.map(([k, o, c]) => makeRow(makeItem(k, o), Number.isInteger(c) && c >= 0 && c < 4 ? c : null)),
    };
  }

  function showResult(R) {
    const { rows, elapsed, timeout } = R;
    lastResult = R;
    const total = rows.length;
    const right = rows.filter((r) => r.status === 'right').length;
    const wrong = rows.filter((r) => r.status === 'wrong').length;
    const skip = total - right - wrong;
    const pct = total ? right / total : 0;
    const score10 = (pct * 10).toFixed(2).replace(/\.?0+$/, '');

    $('scoreBig').textContent = `${right}/${total}`;
    $('scoreSub').textContent = R.mode === 'exam' ? `Điểm ${score10}/10` : `${Math.round(pct * 100)}% đúng`;
    $('stCorrect').textContent = right;
    $('stWrong').textContent = wrong;
    $('stSkip').textContent = skip;
    $('stTime').textContent = fmtTime(elapsed);
    let title, msg;
    if (pct >= 0.9) { title = 'Xuất sắc'; msg = 'Bạn nắm kiến thức rất chắc.'; }
    else if (pct >= 0.7) { title = 'Làm tốt'; msg = 'Ôn thêm vài câu sai là ổn.'; }
    else if (pct >= 0.5) { title = 'Đạt'; msg = 'Hãy xem lại các câu sai bên dưới.'; }
    else { title = 'Cần ôn thêm'; msg = 'Luyện tập lại các câu sai bên dưới.'; }
    if (timeout) msg = 'Hết giờ — bài đã được nộp tự động. ' + msg;
    $('resultTitle').textContent = title;
    $('resultMsg').textContent = msg;
    $('retryWrongBtn').disabled = wrong + skip === 0;

    const ring = $('ringFg');
    const C = 2 * Math.PI * 52;
    ring.style.stroke = pct >= 0.7 ? 'var(--ok)' : pct >= 0.5 ? 'var(--warn)' : 'var(--bad)';
    ring.style.strokeDashoffset = C;
    requestAnimationFrame(() => requestAnimationFrame(() => { ring.style.strokeDashoffset = C * (1 - pct); }));

    reviewFilter = wrong + skip > 0 ? 'wrong' : 'all';
    if (wrong === 0 && skip > 0) reviewFilter = 'skip';
    setActiveChip('reviewFilter', 'f', reviewFilter);
    renderReview();
    show('result');
    window.scrollTo({ top: 0 });
  }

  let reviewFilter = 'all';
  function renderReview() {
    const rows = lastResult.rows
      .map((r, i) => ({ ...r, i }))
      .filter((r) => reviewFilter === 'all' || r.status === reviewFilter);
    if (!rows.length) { $('reviewList').innerHTML = '<div class="empty">Không có câu nào trong mục này.</div>'; return; }
    const tag = { right: 'Đúng', wrong: 'Sai', skip: 'Bỏ trống' };
    $('reviewList').innerHTML = rows.map((r) => `
      <div class="rv ${r.status}">
        <div class="rv-top"><span class="rv-tag">${tag[r.status]}</span><span class="muted">Câu ${r.i + 1} · ${esc(r.it.src.bankName)} câu ${r.it.src.n}</span></div>
        <p class="rv-q">${esc(r.it.src.q)}</p>
        <div class="rv-opts">${r.it.opts.map((o, k) => {
          const cls = k === r.it.ans ? 'correct' : (k === r.chosen ? 'wrong' : '');
          return `<div class="rv-opt ${cls}"><b>${LETTERS[k]}.</b><span>${esc(o)}</span></div>`;
        }).join('')}</div>
      </div>`).join('');
  }
  $('reviewFilter').addEventListener('click', (e) => {
    const b = e.target.closest('button'); if (!b) return;
    reviewFilter = b.dataset.f; setActiveChip('reviewFilter', 'f', reviewFilter); renderReview();
  });
  $('retryWrongBtn').addEventListener('click', () => {
    const keys = lastResult.rows.filter((r) => r.status !== 'right').map((r) => r.it.key);
    if (keys.length) startQuiz(prefs.shuffleQ ? shuffle(keys) : keys, lastResult.mode, 0);
  });
  $('retryAllBtn').addEventListener('click', () => {
    const keys = lastResult.rows.map((r) => r.it.key);
    startQuiz(prefs.shuffleQ ? shuffle(keys) : keys, lastResult.mode, lastResult.limit / 60);
  });
  $('homeBtn').addEventListener('click', goHome);
  $('brandBtn').addEventListener('click', () => {
    if (S && !S.done) $('exitBtn').click(); else goHome();
  });

  // ================= MODAL =================
  let modalOk = null;
  function confirmBox(title, text, okLabel, onOk) {
    $('modalTitle').textContent = title;
    $('modalText').textContent = text;
    $('modalOk').textContent = okLabel || 'Đồng ý';
    modalOk = onOk;
    showModal($('modal'));
    $('modalOk').focus();
  }
  function closeModal() { hideModal($('modal')); modalOk = null; }

  // open/close with enter + exit animation.
  // If the modal was opened by a click, it pops out of (and shrinks back into) that button;
  // otherwise (keyboard) it falls back to the CSS fade/scale.
  const reduceMotion = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
  let lastPress = null;
  document.addEventListener('pointerdown', (e) => {
    const btn = e.target.closest && e.target.closest('button');
    let x = e.clientX, y = e.clientY;
    if (btn) { const r = btn.getBoundingClientRect(); x = r.left + r.width / 2; y = r.top + r.height / 2; }
    lastPress = { x, y, t: performance.now() };
  }, true);
  const recentPress = () => (lastPress && performance.now() - lastPress.t < 1500 ? lastPress : null);

  function deltaTo(box, p) {
    // offsetLeft/Top ignore transforms → final (resting) position of the box
    return { x: p.x - (box.offsetLeft + box.offsetWidth / 2), y: p.y - (box.offsetTop + box.offsetHeight / 2) };
  }

  function showModal(el) {
    clearTimeout(el._hideTimer);
    if (el._anim) { el._anim.cancel(); el._anim = null; }
    const box = el.querySelector('.modal-box');
    const origin = reduceMotion ? null : recentPress();
    el._origin = origin;
    lastPress = null;
    box.style.transition = origin ? 'none' : '';
    el.classList.remove('hidden');
    void el.offsetWidth; // commit start state so the transition runs
    el.classList.add('open');
    if (origin) {
      const d = deltaTo(box, origin);
      el._anim = box.animate([
        { transform: `translate(${d.x}px, ${d.y}px) scale(.06)`, opacity: 0 },
        { opacity: 1, offset: .4 },
        { transform: 'none', opacity: 1 },
      ], { duration: 240, easing: 'cubic-bezier(.2, .9, .25, 1.08)' });
    }
  }
  function hideModal(el) {
    el.classList.remove('open');
    lastPress = null;
    clearTimeout(el._hideTimer);
    if (el._anim) { el._anim.cancel(); el._anim = null; }
    const box = el.querySelector('.modal-box');
    const origin = reduceMotion ? null : el._origin;
    if (origin) {
      const d = deltaTo(box, origin);
      el._anim = box.animate([
        { transform: 'none', opacity: 1 },
        { opacity: 1, offset: .5 },
        { transform: `translate(${d.x}px, ${d.y}px) scale(.06)`, opacity: 0 },
      ], { duration: 150, easing: 'cubic-bezier(.4, 0, .9, .5)', fill: 'forwards' });
    }
    el._hideTimer = setTimeout(() => {
      el.classList.add('hidden');
      if (el._anim) { el._anim.cancel(); el._anim = null; }
      box.style.transition = '';
    }, reduceMotion ? 0 : 170);
  }
  const isOpen = (el) => el.classList.contains('open');
  $('modalCancel').addEventListener('click', closeModal);
  $('modal').addEventListener('click', (e) => { if (e.target === $('modal')) closeModal(); });
  $('modalOk').addEventListener('click', () => { const f = modalOk; closeModal(); if (f) f(); });

  // ================= DATA MANAGER =================
  const THEME_KEY = 'triet_theme';
  const APP_KEYS = [WRONG_KEY, PREF_KEY, THEME_KEY, SESSION_KEY, RESULT_KEY];
  let dMsgTimer = null;

  function dataMsg(text, isErr) {
    const el = $('dMsg');
    el.textContent = text;
    el.classList.toggle('err', !!isErr);
    el.classList.remove('hidden');
    clearTimeout(dMsgTimer);
    dMsgTimer = setTimeout(() => el.classList.add('hidden'), 3500);
  }

  function storedSize() {
    let n = 0;
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k && k.startsWith('triet_')) n += k.length + (localStorage.getItem(k) || '').length;
      }
    } catch (e) { /* ignore */ }
    return n * 2; // UTF-16
  }

  function currentThemePref() {
    try { return localStorage.getItem(THEME_KEY) || 'system'; } catch (e) { return 'system'; }
  }

  function applyTheme(t) {
    const root = document.documentElement;
    try {
      if (t === 'system') { delete root.dataset.theme; localStorage.removeItem(THEME_KEY); }
      else { root.dataset.theme = t; localStorage.setItem(THEME_KEY, t); }
    } catch (e) { if (t !== 'system') root.dataset.theme = t; }
  }

  function renderData() {
    const byBank = {};
    wrongSet.forEach((k) => { const b = ALL[k].bankName; byBank[b] = (byBank[b] || 0) + 1; });
    const parts = Object.entries(byBank).map(([b, n]) => `${b}: ${n}`).join(' · ');
    $('dWrong').textContent = wrongSet.size ? `${wrongSet.size} câu (${parts})` : 'Chưa có câu nào';
    $('dWrongClear').disabled = wrongSet.size === 0;

    const saved = store.get(PREF_KEY, null);
    if (saved) {
      const bankName = (bankList().find((b) => b.id === saved.bank) || {}).name || saved.bank;
      const countTxt = saved.count === 'all' ? 'tất cả' : saved.count + ' câu';
      $('dPrefs').textContent = `${bankName} · ${saved.mode === 'exam' ? 'Thi thử' : 'Luyện tập'} · ${countTxt}`;
    } else {
      $('dPrefs').textContent = 'Đang dùng mặc định';
    }
    $('dPrefsReset').disabled = !saved;

    setActiveChip('dTheme', 't', currentThemePref());
    const kb = storedSize() / 1024;
    $('dSize').textContent = `Đang dùng ${kb === 0 ? '0' : kb < 0.1 ? '< 0.1' : kb.toFixed(1)} KB`;
  }

  function refreshHomeIfVisible() {
    if (!$('home').classList.contains('hidden')) renderHome();
  }

  function openData() {
    renderData();
    $('dMsg').classList.add('hidden');
    showModal($('dataModal'));
  }
  function closeData() { hideModal($('dataModal')); }

  $('dataBtn').addEventListener('click', openData);
  $('dataClose').addEventListener('click', closeData);
  $('dataModal').addEventListener('click', (e) => { if (e.target === $('dataModal')) closeData(); });

  $('dWrongClear').addEventListener('click', () => {
    confirmBox('Xoá danh sách câu đã sai?', `${wrongSet.size} câu sẽ bị xoá khỏi bộ “Câu đã sai”.`, 'Xoá', () => {
      wrongSet.clear(); saveWrong();
      renderData(); refreshHomeIfVisible();
      dataMsg('Đã xoá danh sách câu đã sai.');
    });
  });

  $('dPrefsReset').addEventListener('click', () => {
    try { localStorage.removeItem(PREF_KEY); } catch (e) { /* ignore */ }
    Object.assign(prefs, DEFAULT_PREFS);
    setup = { bank: prefs.bank, count: prefs.count, time: prefs.time };
    renderData(); refreshHomeIfVisible();
    dataMsg('Đã đặt lại tuỳ chọn về mặc định.');
  });

  $('dTheme').addEventListener('click', (e) => {
    const b = e.target.closest('button'); if (!b) return;
    withThemeTransition(() => { applyTheme(b.dataset.t); renderData(); }, b);
  });

  $('dExport').addEventListener('click', () => {
    const payload = {
      app: 'triet-quiz',
      version: 1,
      exportedAt: new Date().toISOString(),
      wrong: [...wrongSet],
      prefs: store.get(PREF_KEY, null),
      theme: currentThemePref(),
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    const d = new Date();
    const stamp = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
    a.href = URL.createObjectURL(blob);
    a.download = `triet-quiz-backup-${stamp}.json`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    dataMsg('Đã xuất file sao lưu.');
  });

  $('dImport').addEventListener('click', () => { $('dImportFile').value = ''; $('dImportFile').click(); });
  $('dImportFile').addEventListener('change', (e) => {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      let data;
      try { data = JSON.parse(reader.result); } catch (err) { dataMsg('File không phải JSON hợp lệ.', true); return; }
      if (!data || data.app !== 'triet-quiz' || !Array.isArray(data.wrong)) { dataMsg('File không đúng định dạng sao lưu của web này.', true); return; }
      const valid = data.wrong.filter((k) => typeof k === 'string' && ALL[k]);
      const before = wrongSet.size;
      valid.forEach((k) => wrongSet.add(k));
      saveWrong();
      if (data.prefs && typeof data.prefs === 'object') {
        const clean = {};
        Object.keys(DEFAULT_PREFS).forEach((k) => { if (k in data.prefs) clean[k] = data.prefs[k]; });
        Object.assign(prefs, DEFAULT_PREFS, clean);
        store.set(PREF_KEY, prefs);
        setup = { bank: prefs.bank, count: String(prefs.count), time: Number(prefs.time) || 0 };
      }
      if (['system', 'light', 'dark'].includes(data.theme)) applyTheme(data.theme);
      renderData(); refreshHomeIfVisible();
      dataMsg(`Đã nhập: thêm ${wrongSet.size - before} câu sai mới (tổng ${wrongSet.size}).`);
    };
    reader.onerror = () => dataMsg('Không đọc được file.', true);
    reader.readAsText(file);
  });

  $('dClearAll').addEventListener('click', () => {
    confirmBox('Xoá toàn bộ dữ liệu?', 'Danh sách câu sai, tuỳ chọn và cài đặt giao diện sẽ bị xoá. Không thể hoàn tác.', 'Xoá hết', () => {
      try {
        const keys = [];
        for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (k && k.startsWith('triet_')) keys.push(k); }
        keys.concat(APP_KEYS).forEach((k) => localStorage.removeItem(k));
      } catch (e) { /* ignore */ }
      wrongSet.clear();
      Object.assign(prefs, DEFAULT_PREFS);
      setup = { bank: prefs.bank, count: prefs.count, time: prefs.time };
      delete document.documentElement.dataset.theme;
      renderData(); refreshHomeIfVisible();
      dataMsg('Đã xoá toàn bộ dữ liệu.');
    });
  });

  // ================= NAV / KEYS =================
  function show(id) {
    ['home', 'quiz', 'result'].forEach((s) => $(s).classList.toggle('hidden', s !== id));
  }
  function goHome() {
    try { localStorage.removeItem(RESULT_KEY); } catch (e) { /* ignore */ }
    renderHome(); show('home'); window.scrollTo({ top: 0 });
  }

  document.addEventListener('keydown', (e) => {
    if (isOpen($('modal'))) {
      if (e.key === 'Escape') closeModal();
      return;
    }
    if (isOpen($('dataModal'))) {
      if (e.key === 'Escape') closeData();
      return;
    }
    if (!S || S.done || $('quiz').classList.contains('hidden')) return;
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.target.tagName === 'INPUT') return;
    const k = e.key.toLowerCase();
    const map = { '1': 0, '2': 1, '3': 2, '4': 3, a: 0, b: 1, c: 2, d: 3 };
    if (k in map) { e.preventDefault(); choose(map[k]); }
    else if (k === 'enter' || k === 'arrowright') {
      e.preventDefault();
      if (S.idx === S.items.length - 1) askSubmit(); else next();
    }
    else if (k === 'arrowleft') { e.preventDefault(); go(-1); }
  });

  // ================= BOOT: restore whatever was on screen before reload =================
  renderHome();
  const restored = loadSession();
  if (restored) {
    S = restored;
    enterQuiz(); // a timed exam that ran out while closed is auto-submitted by the first tick()
  } else {
    clearSession();
    const R = loadResult();
    if (R) showResult(R);
  }
})();
