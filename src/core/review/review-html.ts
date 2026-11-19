import type { ReviewData } from './review-data.js';

/** JSON that is safe inside a <script> element: no "<" (so no "</script>" or "<!--") and no U+2028/9. */
function escapeJsonForScript(json: string): string {
  return json
    .replace(/</g, '\\u003c')
    .replaceAll(String.fromCharCode(0x2028), '\\u2028')
    .replaceAll(String.fromCharCode(0x2029), '\\u2029');
}

const STYLE = `
:root { color-scheme: light dark; --bg:#fafafa; --fg:#1d1d1f; --muted:#6b6b72; --card:#fff; --line:#d9d9de;
  --accent:#2f6fed; --band:rgba(47,111,237,.55); --ok:#1f8f4e; --warn:#c2410c; }
@media (prefers-color-scheme: dark) {
  :root { --bg:#17171a; --fg:#ececf0; --muted:#9a9aa5; --card:#212126; --line:#3a3a42; --accent:#6c9cff;
    --band:rgba(108,156,255,.6); --ok:#4cc27f; --warn:#f08a50; }
}
* { box-sizing: border-box; }
body { margin:0; font:14px/1.45 system-ui, sans-serif; background:var(--bg); color:var(--fg); }
header { position:sticky; top:0; z-index:5; display:flex; flex-wrap:wrap; gap:12px; align-items:center;
  padding:10px 16px; background:var(--card); border-bottom:1px solid var(--line); }
header h1 { font-size:16px; margin:0; }
main { max-width:960px; margin:0 auto; padding:16px; }
h2 { font-size:13px; text-transform:uppercase; letter-spacing:.05em; color:var(--muted); margin:28px 0 8px; }
.clip { background:var(--card); border:1px solid var(--line); border-radius:8px; padding:12px; margin-bottom:16px; }
.clip h3 { margin:0 0 4px; font-size:15px; }
.meta, .tags { color:var(--muted); font-size:12px; margin:2px 0; }
video { width:100%; max-height:420px; background:#000; border-radius:4px; margin-top:8px; }
.noproxy { padding:24px; text-align:center; color:var(--muted); border:1px dashed var(--line); margin-top:8px; }
.bar { position:relative; height:18px; margin:6px 0; background:var(--bg); border:1px solid var(--line); border-radius:3px; }
.band { position:absolute; top:0; bottom:0; min-width:3px; background:var(--band); cursor:pointer; border:0; padding:0; }
.controls { display:flex; gap:12px; align-items:center; flex-wrap:wrap; margin:4px 0 8px; }
.hl { border-top:1px solid var(--line); padding:8px 0; }
.hl-head { display:flex; gap:10px; align-items:baseline; flex-wrap:wrap; }
.verdicts { display:flex; gap:6px; flex-wrap:wrap; margin:6px 0; }
button, select { font:inherit; color:inherit; background:var(--card); border:1px solid var(--line);
  border-radius:4px; padding:2px 8px; cursor:pointer; }
button.on { background:var(--accent); border-color:var(--accent); color:#fff; }
button.on.bad { background:var(--warn); border-color:var(--warn); }
button.on.good { background:var(--ok); border-color:var(--ok); }
input[type=text], textarea { width:100%; font:inherit; color:inherit; background:var(--bg);
  border:1px solid var(--line); border-radius:4px; padding:4px 6px; }
.missed { display:flex; gap:8px; align-items:center; margin:4px 0; }
.missed input { flex:1; }
`;

// Page script: plain DOM code, no framework. Data comes from the #review-data JSON block.
// Note: this lives in a TS template literal, so it must not contain backticks or dollar-brace.
const SCRIPT = `
var data = JSON.parse(document.getElementById('review-data').textContent);
var STORAGE_KEY = 'clippilot-review:' + data.project + ':' + data.generated_at;
var VERDICTS = [['good', 'good'], ['timing', 'timing off'], ['description', 'description off'], ['quality', 'quality off']];

// state.highlights[id] = { verdicts: [], note: '' }; state.missed = [{ clip_id, at_sec, note }]; state.clip_notes[id] = ''
var state = loadState();
var filter = 'all';
var clipEls = [];   // { clip, el } so the filter can show/hide cards
var progressEl, missedLists = {};

function loadState() {
  try {
    var saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
    if (saved) return saved;
  } catch (e) { /* storage unavailable: start empty */ }
  return { highlights: {}, missed: [], clip_notes: {} };
}
function saveState() {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch (e) { /* ignore */ }
  updateProgress();
}
function hlState(id) {
  if (!state.highlights[id]) state.highlights[id] = { verdicts: [], note: '' };
  return state.highlights[id];
}
function isReviewed(id) { return hlState(id).verdicts.length > 0; }
function isFlagged(id) { return hlState(id).verdicts.some(function (v) { return v !== 'good'; }); }

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
  var m = Math.floor(sec / 60), s = (sec % 60).toFixed(1);
  return m + ':' + (s < 10 ? '0' : '') + s;
}

function buildClip(clip) {
  var video = clip.proxy_url ? el('video', { src: clip.proxy_url, controls: '', preload: 'metadata' }) : null;
  var rate = 1, loop = false, range = null;   // range = { start, end } while a highlight is playing

  function playRange(h) {
    if (!video) return;
    range = { start: h.start_sec, end: h.end_sec };
    video.currentTime = h.start_sec;
    video.playbackRate = rate;
    video.play();
  }
  if (video) {
    video.addEventListener('timeupdate', function () {
      if (!range || video.currentTime < range.end) return;
      if (loop) video.currentTime = range.start; else { video.pause(); range = null; }
    });
    video.addEventListener('seeking', function () {
      // user scrubbed outside the range: stop enforcing it
      if (range && (video.currentTime < range.start - 0.3 || video.currentTime > range.end + 0.3)) range = null;
    });
  }

  var bar = el('div', { class: 'bar' });
  clip.highlights.forEach(function (h) {
    var band = el('button', { class: 'band', title: fmt(h.start_sec) + ' ' + h.description, onclick: function () { playRange(h); } });
    band.style.left = (h.start_sec / clip.duration_sec * 100) + '%';
    band.style.width = ((h.end_sec - h.start_sec) / clip.duration_sec * 100) + '%';
    bar.appendChild(band);
  });

  var rateBtn = el('button', { text: '1x', onclick: function () {
    rate = rate === 1 ? 0.5 : 1;
    rateBtn.textContent = rate === 1 ? '1x' : '0.5x';
    if (video) video.playbackRate = rate;
  } });
  var loopBox = el('input', { type: 'checkbox', onchange: function () { loop = loopBox.checked; } });
  var controls = el('div', { class: 'controls' }, [
    rateBtn,
    el('label', {}, [loopBox, document.createTextNode(' loop range')]),
    el('button', { text: '+ missed moment here', onclick: function () {
      state.missed.push({ clip_id: clip.clip_id, at_sec: video ? video.currentTime : 0, note: '' });
      saveState();
      renderMissed(clip, video);
    } }),
  ]);

  var card = el('div', { class: 'clip' }, [
    el('h3', { text: clip.file_name }),
    el('div', { class: 'meta', text: (clip.scene_hint || '(no scene hint)') + ' - ' + fmt(clip.duration_sec) +
      ' - overall quality ' + (clip.quality_overall === null ? '?' : clip.quality_overall) }),
    el('div', { class: 'tags', text: 'places: ' + (clip.places.join(', ') || '-') + ' | moments: ' + (clip.moments.join(', ') || '-') }),
    el('div', { text: clip.ai_summary || '' }),
    video || el('div', { class: 'noproxy', text: 'no proxy' }),
    bar,
    controls,
  ]);

  if (clip.highlights.length === 0) card.appendChild(el('div', { class: 'meta', text: 'No highlights found for this clip.' }));
  clip.highlights.forEach(function (h) { card.appendChild(buildHighlight(h, playRange)); });

  missedLists[clip.clip_id] = el('div');
  card.appendChild(missedLists[clip.clip_id]);
  renderMissed(clip, video);

  var note = el('input', { type: 'text', placeholder: 'clip note', value: state.clip_notes[clip.clip_id] || '',
    oninput: function () { state.clip_notes[clip.clip_id] = note.value; saveState(); } });
  card.appendChild(note);
  return card;
}

function buildHighlight(h, playRange) {
  var st = hlState(h.highlight_id);
  var buttons = VERDICTS.map(function (v) {
    var b = el('button', { text: v[1], onclick: function () {
      var i = st.verdicts.indexOf(v[0]);
      if (i >= 0) st.verdicts.splice(i, 1); else st.verdicts.push(v[0]);
      b.className = st.verdicts.indexOf(v[0]) >= 0 ? 'on ' + (v[0] === 'good' ? 'good' : 'bad') : '';
      saveState();
    } });
    if (st.verdicts.indexOf(v[0]) >= 0) b.className = 'on ' + (v[0] === 'good' ? 'good' : 'bad');
    return b;
  });
  var note = el('input', { type: 'text', placeholder: 'note', value: st.note,
    oninput: function () { st.note = note.value; saveState(); } });
  return el('div', { class: 'hl' }, [
    el('div', { class: 'hl-head' }, [
      el('button', { text: '\\u25B6 play range', onclick: function () { playRange(h); } }),
      el('span', { text: fmt(h.start_sec) + ' - ' + fmt(h.end_sec) }),
      el('span', { class: 'meta', text: 'quality ' + h.quality }),
    ]),
    el('div', { text: h.description }),
    el('div', { class: 'verdicts' }, buttons),
    note,
  ]);
}

function renderMissed(clip, video) {
  var box = missedLists[clip.clip_id];
  box.textContent = '';
  state.missed.forEach(function (m, index) {
    if (m.clip_id !== clip.clip_id) return;
    var note = el('input', { type: 'text', placeholder: 'what is missing here?', value: m.note,
      oninput: function () { m.note = note.value; saveState(); } });
    box.appendChild(el('div', { class: 'missed' }, [
      el('button', { text: 'missed @ ' + fmt(m.at_sec), onclick: function () { if (video) video.currentTime = m.at_sec; } }),
      note,
      el('button', { text: 'remove', onclick: function () {
        state.missed.splice(index, 1);
        saveState();
        renderMissed(clip, video);
      } }),
    ]));
  });
}

function clipMatches(clip) {
  var hasMissed = state.missed.some(function (m) { return m.clip_id === clip.clip_id; });
  if (filter === 'unreviewed') {
    // clips without highlights count as unreviewed until the user adds a note or a missed marker
    if (clip.highlights.length === 0) return !state.clip_notes[clip.clip_id] && !hasMissed;
    return clip.highlights.some(function (h) { return !isReviewed(h.highlight_id); });
  }
  if (filter === 'flagged') {
    return clip.highlights.some(function (h) { return isFlagged(h.highlight_id); }) ||
      hasMissed;
  }
  return true;
}
function applyFilter() {
  clipEls.forEach(function (c) { c.el.style.display = clipMatches(c.clip) ? '' : 'none'; });
}
function updateProgress() {
  var total = 0, reviewed = 0;
  data.clips.forEach(function (c) {
    c.highlights.forEach(function (h) { total++; if (isReviewed(h.highlight_id)) reviewed++; });
  });
  progressEl.textContent = 'reviewed ' + reviewed + ' / ' + total + ' highlights';
}

function exportVerdicts() {
  var out = { project: data.project, db_generated_at: data.generated_at, reviewed_at: new Date().toISOString(),
    highlights: [], missed: state.missed, clip_notes: [] };
  data.clips.forEach(function (c) {
    c.highlights.forEach(function (h) {
      var st = hlState(h.highlight_id);
      if (st.verdicts.length || st.note) {
        out.highlights.push({ highlight_id: h.highlight_id, clip_id: c.clip_id, verdicts: st.verdicts, note: st.note });
      }
    });
    if (state.clip_notes[c.clip_id]) out.clip_notes.push({ clip_id: c.clip_id, note: state.clip_notes[c.clip_id] });
  });
  var url = URL.createObjectURL(new Blob([JSON.stringify(out, null, 2)], { type: 'application/json' }));
  var a = el('a', { href: url, download: 'review-verdicts.json' });
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function init() {
  progressEl = el('span');
  var select = el('select', { onchange: function () { filter = select.value; applyFilter(); } }, [
    el('option', { value: 'all', text: 'all' }),
    el('option', { value: 'unreviewed', text: 'unreviewed' }),
    el('option', { value: 'flagged', text: 'flagged' }),
  ]);
  document.getElementById('header').appendChild(el('h1', { text: 'Highlight review: ' + data.project }));
  document.getElementById('header').appendChild(progressEl);
  document.getElementById('header').appendChild(el('label', {}, [document.createTextNode('show '), select]));
  document.getElementById('header').appendChild(el('button', { text: 'Export verdicts', onclick: exportVerdicts }));

  var main = document.getElementById('main');
  var lastHint;
  data.clips.forEach(function (clip) {
    if (clip.scene_hint !== lastHint) {
      main.appendChild(el('h2', { text: clip.scene_hint || '(no scene hint)' }));
      lastHint = clip.scene_hint;
    }
    var card = buildClip(clip);
    clipEls.push({ clip: clip, el: card });
    main.appendChild(card);
  });
  updateProgress();
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
