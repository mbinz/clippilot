import type { ReviewData } from './review-data.js';

/** JSON that is safe inside a <script> element: no "<" (so no "</script>" or "<!--") and no U+2028/9. */
function escapeJsonForScript(json: string): string {
  return json
    .replace(/</g, '\\u003c')
    .replaceAll(String.fromCharCode(0x2028), '\\u2028')
    .replaceAll(String.fromCharCode(0x2029), '\\u2029');
}

const STYLE = `
  :root{
    --bg:#0f1115; --panel:#171a21; --panel2:#1e222b; --line:#2a2f3a;
    --text:#e8eaf0; --muted:#8b93a3; --accent:#7c9cff;
    --good:#3ecf8e; --bad:#ff6b6b; --warn:#ffb547; --seg:#3a4150;
  }
  *{box-sizing:border-box}
  body{margin:0;background:var(--bg);color:var(--text);font:14px/1.45 -apple-system,BlinkMacSystemFont,"Inter",system-ui,sans-serif}
  header{display:flex;align-items:center;gap:20px;padding:12px 24px;border-bottom:1px solid var(--line);position:sticky;top:0;background:var(--bg);z-index:5}
  header h1{font-size:15px;margin:0;font-weight:600}
  header .sub{color:var(--muted);font-size:13px}
  .progress{display:flex;gap:4px;flex:1;max-width:420px}
  .progress span{flex:1;height:6px;border-radius:3px;background:var(--seg)}
  .progress span.done{background:var(--good)}
  .progress span.cur{background:var(--accent)}
  .btn{background:var(--panel2);border:1px solid var(--line);color:var(--text);border-radius:8px;padding:8px 14px;font:inherit;cursor:pointer}
  .btn:hover{border-color:#3d4452}
  .btn.primary{background:var(--accent);border-color:var(--accent);color:#0b0d12;font-weight:600}
  .spacer{flex:1}
  main{display:grid;grid-template-columns:minmax(0,1fr) 440px;gap:20px;padding:20px 24px}
  /* left */
  .stage{position:sticky;top:76px;align-self:start}
  video{width:100%;max-height:calc(100vh - 230px);background:#000;border-radius:10px;display:block}
  .timeline{position:relative;height:34px;margin-top:12px;background:var(--panel);border-radius:6px;cursor:pointer}
  .timeline .hl{position:absolute;top:6px;bottom:6px;border-radius:4px;background:#4a5366;border:1px solid transparent}
  .timeline .hl.sel{outline:2px solid var(--accent);outline-offset:1px}
  .timeline .hl.good{background:rgba(62,207,142,.55)}
  .timeline .hl.bad{background:rgba(255,107,107,.55)}
  .timeline .miss{position:absolute;top:0;bottom:0;width:3px;background:var(--warn);border-radius:2px}
  .timeline .miss::after{content:"★";position:absolute;top:-16px;left:-5px;color:var(--warn);font-size:12px}
  .timeline .head{position:absolute;top:-3px;bottom:-3px;width:2px;background:#fff;pointer-events:none}
  .under{display:flex;align-items:center;gap:10px;margin-top:12px;color:var(--muted);font-size:13px}
  .keys{margin-left:auto}
  kbd{background:var(--panel2);border:1px solid var(--line);border-bottom-width:2px;border-radius:4px;padding:0 5px;font:12px ui-monospace,monospace;color:var(--text)}
  /* right */
  .side{display:flex;flex-direction:column;gap:12px}
  .card{background:var(--panel);border:1px solid var(--line);border-radius:12px;padding:12px 14px}
  .clipline{display:flex;align-items:baseline;gap:10px;flex-wrap:wrap}
  .clipname{font-weight:600;font-size:15px}
  .clipmeta{color:var(--muted);font-size:12px}
  .summary{color:#c3c8d3;margin-top:8px;font-size:13px}
  .tier{font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:.04em;padding:2px 8px;border-radius:999px;background:var(--panel2);color:var(--muted)}
  .tier.hero{background:rgba(255,181,71,.18);color:var(--warn)}
  .tier.solid{background:rgba(124,156,255,.16);color:var(--accent)}
  .tier.filler{background:var(--panel2);color:var(--muted)}
  .shotrole{font-size:12px;color:var(--muted)}
  .issues{display:flex;flex-wrap:wrap;gap:6px;margin-top:6px}
  .issue{font-size:11px;padding:2px 8px;border-radius:999px;background:rgba(255,107,107,.12);color:var(--bad)}
  .slowmo{font-size:12px;padding:2px 8px;border-radius:999px;background:rgba(124,156,255,.16);color:var(--accent);font-weight:600}
  .spd{font-size:12px;padding:2px 8px;border-radius:6px;border:1px solid var(--line);background:var(--panel2);color:var(--text);cursor:pointer}
  .spd.on{border-color:var(--accent);color:var(--accent)}
  .slowwhy{margin-top:4px;font-size:12px;color:var(--muted)}
  /* highlights */
  .hlist{display:flex;flex-direction:column;gap:8px}
  .h{background:var(--panel);border:1px solid var(--line);border-radius:12px;padding:12px 14px;cursor:pointer}
  .h.sel{border-color:var(--accent);box-shadow:0 0 0 1px var(--accent) inset}
  .h.good{border-left:4px solid var(--good)}
  .h.bad{border-left:4px solid var(--bad)}
  .h-top{display:flex;align-items:center;gap:10px}
  .time{font:12px ui-monospace,monospace;color:var(--muted)}
  .thumbs{margin-left:auto;display:flex;gap:6px}
  .thumb{width:38px;height:34px;border-radius:8px;border:1px solid var(--line);background:var(--panel2);font-size:16px;cursor:pointer;filter:grayscale(1);opacity:.75}
  .thumb:hover{opacity:1;filter:none}
  .thumb.up.on{background:rgba(62,207,142,.18);border-color:var(--good);filter:none;opacity:1}
  .thumb.down.on{background:rgba(255,107,107,.18);border-color:var(--bad);filter:none;opacity:1}
  .desc{margin-top:6px;font-size:13px;color:#d4d8e1}
  .reasons{margin-top:10px;display:none;flex-wrap:wrap;gap:6px}
  .h.bad .reasons{display:flex}
  .chip{font-size:12px;padding:5px 10px;border-radius:999px;border:1px solid var(--line);background:var(--panel2);color:var(--text);cursor:pointer}
  .chip.on{background:var(--bad);border-color:var(--bad);color:#1a0b0b;font-weight:600}
  .chip kbd{margin-right:4px}
  .note{width:100%;margin-top:6px;background:var(--bg);border:1px solid var(--line);border-radius:8px;color:var(--text);padding:7px 10px;font:inherit;font-size:13px}
  .missed{background:var(--panel);border:1px dashed var(--warn);border-radius:12px;padding:10px 14px;display:flex;gap:10px;align-items:center;font-size:13px}
  .missed .time{color:var(--warn)}
  .missed input{flex:1;background:transparent;border:0;color:var(--text);font:inherit}
  .footer{display:flex;gap:10px;position:sticky;bottom:0;padding:12px 0;background:linear-gradient(transparent,var(--bg) 30%)}
  .footer .btn{flex:1}
  @media (max-width:1000px){main{grid-template-columns:1fr}.stage{position:static}.keys{display:none}}

  .empty{color:var(--muted);text-align:center;padding:22px 14px;border:1px dashed var(--line);border-radius:12px}
  .noproxy{display:flex;align-items:center;justify-content:center;height:240px;background:#000;border-radius:10px;color:var(--muted)}
`;

// Page script: plain DOM code, no framework. Data comes from the #review-data JSON block.
// Note: this lives in a TS template literal, so it must not contain backticks or dollar-brace.
const SCRIPT = `
var data = JSON.parse(document.getElementById('review-data').textContent);
var STORAGE_KEY = 'clippilot-review-v2:' + data.project + ':' + data.generated_at;
var REASONS = [['not_highlight', 'Not a highlight'], ['timing', 'Timing off'], ['description', 'Description wrong'], ['quality', 'Shaky / poor quality'], ['speed', 'Speed wrong']];

// state.highlights[id] = { vote: 'good'|'bad'|null, reasons: { key: true }, note: '' }
// state.missed = [{ clip_id, at_sec, note }]; state.done[clip_id] = true
// fullSpeed[highlight_id] = true while the user compares a slow-mo suggestion with 100 % (not persisted)
var state = loadState();
var cur = 0, sel = 0, range = null;
var fullSpeed = {};
var video = null;
var stageEl, sideEl, headerEl;

function loadState() {
  var st = {};
  try { st = JSON.parse(localStorage.getItem(STORAGE_KEY)) || {}; } catch (e) { st = {}; }
  st.highlights = st.highlights || {};
  st.missed = st.missed || [];
  st.done = st.done || {};
  return st;
}
function saveState() {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch (e) { /* storage unavailable */ }
}
function hlState(id) {
  if (!state.highlights[id]) state.highlights[id] = { vote: null, reasons: {}, note: '' };
  return state.highlights[id];
}

function el(tag, props, children) {
  var node = document.createElement(tag);
  for (var k in (props || {})) {
    if (k === 'class') node.className = props[k];
    else if (k === 'text') node.textContent = props[k];
    else if (k.indexOf('on') === 0) node.addEventListener(k.slice(2), props[k]);
    else node.setAttribute(k, props[k]);
  }
  (children || []).forEach(function (c) { node.appendChild(c); });
  return node;
}
function fmt(sec) {
  var s = Math.round(sec);
  return Math.floor(s / 60) + ':' + ('0' + (s % 60)).slice(-2);
}
function clip() { return data.clips[cur]; }

// ---- derived verdicts -------------------------------------------------------------
function verdictsOf(id) {
  var st = hlState(id);
  if (st.vote === 'good') return ['good'];
  if (st.vote === 'bad') {
    return ['bad'].concat(REASONS.filter(function (r) { return st.reasons[r[0]]; }).map(function (r) { return r[0]; }));
  }
  return [];
}
function isTouched(c) {
  if (state.done[c.clip_id]) return true;
  if (state.missed.some(function (m) { return m.clip_id === c.clip_id; })) return true;
  return c.highlights.some(function (h) { var st = hlState(h.highlight_id); return st.vote || st.note; });
}

function buildExport() {
  var out = { project: data.project, db_generated_at: data.generated_at, reviewed_at: new Date().toISOString(),
    highlights: [], missed: state.missed.map(function (m) { return { clip_id: m.clip_id, at_sec: m.at_sec, note: m.note }; }),
    clip_notes: [], clip_scores: [], suggested_use_wrong: [], reviewed_clips: [] };
  data.clips.forEach(function (c) {
    c.highlights.forEach(function (h) {
      var v = verdictsOf(h.highlight_id), st = hlState(h.highlight_id);
      if (v.length || st.note) out.highlights.push({ highlight_id: h.highlight_id, clip_id: c.clip_id, verdicts: v, note: st.note });
    });
    if (isTouched(c)) out.reviewed_clips.push(c.clip_id);
  });
  return out;
}
function downloadExport() {
  var url = URL.createObjectURL(new Blob([JSON.stringify(buildExport(), null, 2)], { type: 'application/json' }));
  var a = el('a', { href: url, download: 'review-verdicts.json' });
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

// ---- playback -----------------------------------------------------------------------
function applyRate() {
  if (!video) return;
  var h = range ? clip().highlights[sel] : null;
  var slow = h && h.suggested_speed < 1 && !fullSpeed[h.highlight_id];
  try { video.playbackRate = slow ? h.suggested_speed : 1; } catch (e) { /* ignore */ }
}
function toggleSpeed(i) {
  var h = clip().highlights[i];
  if (!h || !(h.suggested_speed < 1)) return;
  if (fullSpeed[h.highlight_id]) delete fullSpeed[h.highlight_id]; else fullSpeed[h.highlight_id] = true;
  sel = i;
  applyRate();
  renderSide();
}
function playHighlight(i) {
  var c = clip();
  var h = c.highlights[i];
  if (!h) return;
  sel = i;
  range = { start: h.start_sec, end: h.end_sec };
  if (video) {
    video.currentTime = h.start_sec;
    applyRate();
    try { var p = video.play(); if (p && p.catch) p.catch(function () { /* autoplay blocked */ }); } catch (e) { /* ignore */ }
  }
  renderSide();
  renderTimeline();
}
function selectOnly(i) { sel = i; renderSide(); renderTimeline(); }
function togglePlay() {
  if (!video) return;
  if (video.paused) { var p = video.play(); if (p && p.catch) p.catch(function () { /* ignore */ }); } else video.pause();
}

// ---- actions ------------------------------------------------------------------------
function vote(i, val) {
  var h = clip().highlights[i];
  if (!h) return;
  var st = hlState(h.highlight_id);
  if (st.vote === val) { st.vote = null; st.reasons = {}; saveState(); sel = i; renderSide(); renderTimeline(); renderHeader(); return; }
  st.vote = val;
  if (val === 'good') st.reasons = {};
  saveState();
  renderHeader();
  if (val === 'good' && i < clip().highlights.length - 1) playHighlight(i + 1);
  else { sel = i; renderSide(); renderTimeline(); }
}
function toggleReason(i, key) {
  var h = clip().highlights[i];
  if (!h) return;
  var st = hlState(h.highlight_id);
  if (st.vote !== 'bad') return;
  if (st.reasons[key]) delete st.reasons[key]; else st.reasons[key] = true;
  saveState();
  renderSide();
}
function addMissed() {
  state.missed.push({ clip_id: clip().clip_id, at_sec: video ? video.currentTime : 0, note: '' });
  saveState();
  renderSide();
  renderTimeline();
  renderHeader();
}
function goTo(idx, markDone) {
  if (markDone) { state.done[clip().clip_id] = true; saveState(); }
  cur = Math.max(0, Math.min(data.clips.length - 1, idx));
  showClip();
}

// ---- rendering ----------------------------------------------------------------------
function renderHeader() {
  headerEl.textContent = '';
  var prog = el('div', { class: 'progress' });
  data.clips.forEach(function (c, i) {
    prog.appendChild(el('span', { class: i === cur ? 'cur' : (state.done[c.clip_id] ? 'done' : '') }));
  });
  headerEl.appendChild(el('h1', { text: 'ClipPilot review' }));
  headerEl.appendChild(el('span', { class: 'sub', text: data.project + ' · clip ' + (cur + 1) + ' of ' + data.clips.length }));
  headerEl.appendChild(prog);
  headerEl.appendChild(el('span', { class: 'spacer' }));
  headerEl.appendChild(el('button', { class: 'btn primary', id: 'export', text: 'Export verdicts', onclick: downloadExport }));
}

function renderTimeline() {
  var c = clip();
  var tl = document.getElementById('tl');
  if (!tl) return;
  tl.textContent = '';
  c.highlights.forEach(function (h, i) {
    var st = hlState(h.highlight_id);
    var d = el('div', { class: 'hl' + (i === sel ? ' sel' : '') + (st.vote ? ' ' + st.vote : ''), title: h.description });
    d.setAttribute('data-i', String(i));
    d.style.left = (h.start_sec / c.duration_sec * 100) + '%';
    d.style.width = ((h.end_sec - h.start_sec) / c.duration_sec * 100) + '%';
    tl.appendChild(d);
  });
  state.missed.forEach(function (m) {
    if (m.clip_id !== c.clip_id) return;
    var d = el('div', { class: 'miss' });
    d.style.left = (m.at_sec / c.duration_sec * 100) + '%';
    tl.appendChild(d);
  });
  var head = el('div', { class: 'head', id: 'head' });
  tl.appendChild(head);
  updateHead();
}
function updateHead() {
  var head = document.getElementById('head');
  if (head && video) head.style.left = (video.currentTime / clip().duration_sec * 100) + '%';
}

function thumbBtn(kind, on, extra) {
  var b = el('button', { class: 'thumb ' + (kind === 'up' ? 'up' : 'down') + (on ? ' on' : ''), text: kind === 'up' ? '👍' : '👎' });
  for (var k in (extra || {})) b.setAttribute(k, extra[k]);
  return b;
}

function highlightCard(h, i) {
  var st = hlState(h.highlight_id);
  var up = thumbBtn('up', st.vote === 'good');
  var down = thumbBtn('down', st.vote === 'bad');
  up.addEventListener('click', function (e) { e.stopPropagation(); vote(i, 'good'); });
  down.addEventListener('click', function (e) { e.stopPropagation(); vote(i, 'bad'); });
  var reasons = el('div', { class: 'reasons' });
  REASONS.forEach(function (r, ri) {
    var chip = el('span', { class: 'chip' + (st.reasons[r[0]] ? ' on' : '') }, [el('kbd', { text: String(ri + 1) }), document.createTextNode(r[1])]);
    chip.setAttribute('data-r', r[0]);
    chip.addEventListener('click', function (e) { e.stopPropagation(); toggleReason(i, r[0]); });
    reasons.appendChild(chip);
  });
  var note = el('input', { class: 'note', type: 'text', placeholder: 'Optional note…', value: st.note });
  note.addEventListener('input', function () { st.note = note.value; saveState(); });
  note.addEventListener('click', function (e) { e.stopPropagation(); });
  reasons.appendChild(note);
  var card = el('div', { class: 'h' + (i === sel ? ' sel' : '') + (st.vote ? ' ' + st.vote : '') }, [
    el('div', { class: 'h-top' }, [
      el('span', { class: 'time', text: fmt(h.start_sec) + '–' + fmt(h.end_sec) }),
      el('span', { class: 'tier ' + h.tier, text: h.tier }),
      el('span', { class: 'shotrole', text: [h.shot, h.role].filter(Boolean).join(' · ') }),
      el('span', { class: 'thumbs' }, [up, down]),
    ]),
    el('div', { class: 'desc', text: h.description }),
    reasons,
  ]);
  if (h.issues && h.issues.length) {
    var issues = el('div', { class: 'issues' });
    h.issues.forEach(function (t) { issues.appendChild(el('span', { class: 'issue', text: t })); });
    card.insertBefore(issues, card.querySelector('.desc').nextSibling);
  }
  if (h.suggested_speed < 1) {
    var pct = Math.round(h.suggested_speed * 100);
    var top = card.querySelector('.h-top');
    var anchor = top.querySelector('.shotrole');
    var badge = el('span', { class: 'slowmo', text: '🐢 ' + pct + ' %', title: h.slowmo_reason || '' });
    var spd = el('button', { class: 'spd' + (fullSpeed[h.highlight_id] ? ' on' : ''), text: '1×', title: 'Compare with 100 % speed (S)' });
    spd.addEventListener('click', function (e) { e.stopPropagation(); toggleSpeed(i); });
    top.insertBefore(badge, anchor.nextSibling);
    top.insertBefore(spd, badge.nextSibling);
    if (h.slowmo_reason) card.insertBefore(el('div', { class: 'slowwhy', text: h.slowmo_reason }), card.querySelector('.desc').nextSibling);
  }
  card.setAttribute('data-i', String(i));
  card.addEventListener('click', function () { playHighlight(i); });
  return card;
}

function renderSide() {
  var c = clip();
  var side = sideEl;
  side.textContent = '';

  var meta = [c.scene_hint || '(no scene hint)', fmt(c.duration_sec)];
  if (c.fps) meta.push(Math.round(c.fps) + ' fps');
  var clipCard = el('div', { class: 'card' }, [
    el('div', { class: 'clipline' }, [
      el('span', { class: 'clipname', text: c.file_name }),
      el('span', { class: 'clipmeta', text: meta.join(' · ') }),
    ]),
    el('div', { class: 'summary', text: c.ai_summary || '' }),
  ]);
  side.appendChild(clipCard);

  var list = el('div', { class: 'hlist' });
  if (c.highlights.length === 0) {
    list.appendChild(el('div', { class: 'empty', text: 'No highlights — press M for anything it missed, then ⏎' }));
  }
  c.highlights.forEach(function (h, i) { list.appendChild(highlightCard(h, i)); });
  state.missed.forEach(function (m, mi) {
    if (m.clip_id !== c.clip_id) return;
    var note = el('input', { type: 'text', placeholder: 'What did it miss? (optional)', value: m.note });
    note.addEventListener('input', function () { m.note = note.value; saveState(); });
    var rm = el('span', { text: '✕', style: 'cursor:pointer;color:var(--muted)' });
    rm.setAttribute('data-rm', String(mi));
    rm.addEventListener('click', function () { state.missed.splice(mi, 1); saveState(); renderSide(); renderTimeline(); renderHeader(); });
    list.appendChild(el('div', { class: 'missed' }, [el('span', { class: 'time', text: '★ ' + fmt(m.at_sec) }), note, rm]));
  });
  side.appendChild(list);

  side.appendChild(el('div', { class: 'footer' }, [
    el('button', { class: 'btn', id: 'prev', text: '← Prev', onclick: function () { goTo(cur - 1, false); } }),
    el('button', { class: 'btn primary', id: 'next', text: 'Next clip ⏎', onclick: function () { goTo(cur + 1, true); } }),
  ]));
}

function showClip() {
  var c = clip();
  sel = 0;
  range = null;
  stageEl.textContent = '';
  video = null;
  if (c.proxy_url) {
    video = el('video', { id: 'v', controls: '', muted: '', preload: 'metadata', src: c.proxy_url });
    video.addEventListener('timeupdate', function () {
      updateHead();
      if (range && video.currentTime >= range.end) { video.currentTime = range.start; }   // loop the selected highlight
    });
    video.addEventListener('seeking', function () {
      if (range && (video.currentTime < range.start - 0.3 || video.currentTime > range.end + 0.3)) { range = null; applyRate(); }
    });
    stageEl.appendChild(video);
  } else {
    stageEl.appendChild(el('div', { class: 'noproxy', text: 'no proxy' }));
  }
  var tl = el('div', { class: 'timeline', id: 'tl' });
  tl.addEventListener('click', function (e) {
    var blk = e.target.closest ? e.target.closest('.hl') : null;
    if (blk) { playHighlight(Number(blk.getAttribute('data-i'))); return; }
    var r = tl.getBoundingClientRect();
    if (video && r.width > 0) { range = null; applyRate(); video.currentTime = (e.clientX - r.left) / r.width * clip().duration_sec; }
  });
  stageEl.appendChild(tl);
  stageEl.appendChild(el('div', { class: 'under' }, [
    el('button', { class: 'btn', id: 'missbtn', text: '★ Missed a moment here', onclick: addMissed }),
    el('span', { class: 'keys' }, keyHints()),
  ]));
  renderHeader();
  renderSide();
  renderTimeline();
  window.scrollTo(0, 0);
}
function keyHints() {
  var out = [];
  function k(t) { out.push(el('kbd', { text: t })); }
  function s(t) { out.push(document.createTextNode(t)); }
  k('↑'); k('↓'); s(' highlight  '); k('Y'); s(' 👍  '); k('N'); s(' 👎  ');
  k('S'); s(' speed  '); k('M'); s(' missed  '); k('Space'); s(' play  '); k('⏎'); s(' next clip');
  return out;
}

document.addEventListener('keydown', function (e) {
  var t = e.target;
  if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT')) return;
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  var k = String(e.key).toLowerCase();
  var n = clip().highlights.length;
  if (k === 'arrowdown') { e.preventDefault(); if (n) playHighlight(Math.min(sel + 1, n - 1)); }
  else if (k === 'arrowup') { e.preventDefault(); if (n) playHighlight(Math.max(sel - 1, 0)); }
  else if (k === 'y') vote(sel, 'good');
  else if (k === 'n') vote(sel, 'bad');
  else if (k === 'm') addMissed();
  else if (k === 's') toggleSpeed(sel);
  else if (k === ' ') { e.preventDefault(); togglePlay(); }
  else if (k === 'enter') { e.preventDefault(); goTo(cur + 1, true); }
  else if (/^[1-5]$/.test(k)) toggleReason(sel, REASONS[Number(k) - 1][0]);
});

function init() {
  headerEl = document.getElementById('header');
  var main = document.getElementById('main');
  stageEl = el('section', { class: 'stage' });
  sideEl = el('aside', { class: 'side' });
  main.appendChild(stageEl);
  main.appendChild(sideEl);
  window.clippilotReview = { buildExport: buildExport };
  if (!data.clips.length) { headerEl.textContent = 'No clips to review.'; return; }
  for (var i = 0; i < data.clips.length; i++) { if (!state.done[data.clips[i].clip_id]) { cur = i; break; } }
  showClip();
}
init();
`;

export function renderReviewHtml(data: ReviewData): string {
  const json = escapeJsonForScript(JSON.stringify(data));
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Highlight review</title>
<style>${STYLE}</style>
</head>
<body>
<header id="header"></header>
<main id="main"></main>
<script type="application/json" id="review-data">${json}</script>
<script>${SCRIPT}</script>
</body>
</html>
`;
}
