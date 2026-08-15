'use strict';

/**
 * CapCut-like Edit-T1: multi-stem tracks (cam/screen/audio), full-height playhead,
 * split / delete (ripple), edge resize, preview rate. Linked stems share clips[].
 */
(function studioUi() {
  const studio = window.stemStudio;
  const ops = window.StemClipOps;
  const gapChips = window.StemGapChips;
  if (!studio || !ops) return;

  const LANES = [
    { id: 'cam', file: 'cam.mp4', kind: 'video', label: 'cam.mp4' },
    { id: 'screen', file: 'screen.mp4', kind: 'video', label: 'screen.mp4' },
    { id: 'audio', file: 'audio.mp3', kind: 'audio', label: 'audio.mp3' },
  ];

  const views = {
    record: document.getElementById('view-record'),
    library: document.getElementById('view-library'),
    edit: document.getElementById('view-edit'),
  };
  const navBtns = document.querySelectorAll('[data-nav]');
  const takeList = document.getElementById('libraryTakes');
  const editTitle = document.getElementById('editTitle');
  const editVideo = document.getElementById('editVideo');
  const clipList = document.getElementById('clipList');
  const editStatus = document.getElementById('editStatus');
  const editTimeLabel = document.getElementById('editTimeLabel');
  const saveManifestBtn = document.getElementById('saveManifestBtn');
  const applyBtn = document.getElementById('applyBtn');
  const openFolderBtn = document.getElementById('openFolderBtn');
  const backLibraryBtn = document.getElementById('backLibraryBtn');
  const clipInSec = document.getElementById('clipInSec');
  const clipOutSec = document.getElementById('clipOutSec');
  const setClipRangeBtn = document.getElementById('setClipRangeBtn');
  const splitBtn = document.getElementById('splitBtn');
  const undoBtn = document.getElementById('undoBtn');
  const redoBtn = document.getElementById('redoBtn');
  const cutBtn = document.getElementById('cutBtn');
  const freezeBtn = document.getElementById('freezeBtn');
  const markInBtn = document.getElementById('markInBtn');
  const markOutBtn = document.getElementById('markOutBtn');
  const cutRangeBtn = document.getElementById('cutRangeBtn');
  const magnetBtn = document.getElementById('magnetBtn');
  const snapBtn = document.getElementById('snapBtn');
  const rateSelect = document.getElementById('rateSelect');
  const tlLanes = document.getElementById('tlLanes');
  const tlPlayhead = document.getElementById('tlPlayhead');
  const tlPlayheadCap = document.getElementById('tlPlayheadCap');
  const tlPlayheadLayer = document.getElementById('tlPlayheadLayer');
  const tlRuler = document.getElementById('tlRuler');
  const tlChips = document.getElementById('tlChips');
  const tlInner = document.getElementById('tlInner');
  const tlOutTime = document.getElementById('tlOutTime');
  const tlPlayBtn = document.getElementById('tlPlayBtn');
  const zoomRange = document.getElementById('zoomRange');
  const zoomInBtn = document.getElementById('zoomInBtn');
  const zoomOutBtn = document.getElementById('zoomOutBtn');
  const transcribeBtn = document.getElementById('transcribeBtn');
  const asrLocalBtn = document.getElementById('asrLocalBtn');
  const asrCloudBtn = document.getElementById('asrCloudBtn');
  const transcriptPanel = document.getElementById('transcriptPanel');
  const wavePanel = document.getElementById('wavePanel');
  const wavePanelCanvas = document.getElementById('wavePanelCanvas');
  const wavePanelEmpty = document.getElementById('wavePanelEmpty');
  const waveZoomInBtn = document.getElementById('waveZoomInBtn');
  const waveZoomOutBtn = document.getElementById('waveZoomOutBtn');
  const editStage = document.getElementById('editStage');
  const cropBtn = document.getElementById('cropBtn');
  const cropOverlay = document.getElementById('cropOverlay');
  const cropRect = document.getElementById('cropRect');
  const cropActions = document.getElementById('cropActions');
  const cropDoneBtn = document.getElementById('cropDoneBtn');
  const cropClearBtn = document.getElementById('cropClearBtn');
  const cropCancelBtn = document.getElementById('cropCancelBtn');
  const camMirrorBtn = document.getElementById('camMirrorBtn');
  const camRotateBtn = document.getElementById('camRotateBtn');
  const camPipBtn = document.getElementById('camPipBtn');
  const pipVideo = document.getElementById('pipVideo');
  const pipHandle = document.getElementById('pipHandle');
  const captionsBtn = document.getElementById('captionsBtn');
  const captionOverlay = document.getElementById('captionOverlay');
  const exportRateSelect = document.getElementById('exportRateSelect');
  const musicBtn = document.getElementById('musicBtn');

  let currentTakeId = null;
  let manifest = null;
  let duration = null;
  let urls = {};
  let selectedIdx = 0;
  let outputTime = 0;
  let playing = false;
  let draggingPlayhead = false;
  let resizing = null;
  let syncingFromTimeline = false;
  let magnetOn = true;
  let snapOn = true;
  let pxPerSec = 100;
  let previewStem = 'screen';
  let playbackRate = 1;
  let asrProvider = sessionStorage.getItem('asrProvider') === 'cloud' ? 'cloud' : 'local';
  /** Source-time marks for Cut range (null until set). */
  let markIn = null;
  let markOut = null;
  /** Real filmstrip frames + waveform peaks (disk-cached by the main process). */
  let filmstrips = { cam: null, screen: null };
  let waveform = null;
  /** Gap/retake cut suggestions (source-time ranges) + the cues they came from. */
  let chips = [];
  let transcriptCues = [];
  /** Selection index the timeline DOM was last built for — scrub repaints skip rebuilds. */
  let renderedSelectedIdx = -1;
  /** Wave-panel zoom (1 = full take) + drag state (window frozen during a drag). */
  let waveZoom = 1;
  let draggingWave = null;
  /** I.3 screen crop: draft rect (normalized 0–1) while crop mode is on. */
  let cropMode = false;
  let cropDraft = null;
  /** In-session undo/redo over clip-list snapshots (not persisted to disk). */
  const undoStack = window.StemUndoStack ? window.StemUndoStack.createUndoStack(100) : null;
  /** I.6 in-memory clip clipboard — per take (cleared on openEdit: clips reference this take's media). */
  let clipClipboard = null;

  const CUT_PAUSE_HELP =
    'Cut a pause: Split @ A · Split @ B · Delete middle (ripple) — or Mark In / Mark Out → Cut range';

  function setStatus(msg, kind) {
    editStatus.textContent = msg || '';
    editStatus.dataset.kind = kind || '';
  }

  function marksHint() {
    const inn = markIn == null ? '—' : fmt(markIn);
    const out = markOut == null ? '—' : fmt(markOut);
    return `marks In ${inn} · Out ${out}`;
  }

  function showView(name) {
    Object.entries(views).forEach(([key, el]) => {
      if (!el) return;
      el.hidden = key !== name;
    });
    navBtns.forEach((btn) => {
      btn.classList.toggle('active', btn.getAttribute('data-nav') === name);
    });
    if (name === 'library') refreshLibrary();
  }

  navBtns.forEach((btn) => {
    btn.addEventListener('click', () => showView(btn.getAttribute('data-nav')));
  });

  document.querySelectorAll('[data-preview]').forEach((btn) => {
    btn.addEventListener('click', () => {
      previewStem = btn.getAttribute('data-preview');
      document.querySelectorAll('[data-preview]').forEach((b) => {
        b.classList.toggle('active', b === btn);
      });
      loadPreviewStem();
    });
  });

  async function refreshLibrary() {
    takeList.innerHTML = '';
    const takes = await studio.listTakes();
    if (!takes.length) {
      takeList.innerHTML = '<p class="empty">No takes yet. Record one first.</p>';
      return;
    }
    for (const t of takes) {
      const row = document.createElement('button');
      row.type = 'button';
      row.className = 'take-row';
      const flags = [
        t.hasScreen ? 'screen' : null,
        t.hasCam ? 'cam' : null,
        t.hasAudio ? 'audio' : null,
        t.hasManifest ? 'edit' : null,
        t.hasFinal ? 'final' : null,
      ].filter(Boolean).join(' · ');
      row.innerHTML = `<strong>${t.id}</strong><span>${flags || 'empty'}</span>`;
      row.disabled = !t.hasScreen;
      row.addEventListener('click', () => openEdit(t.id));
      takeList.appendChild(row);
    }
  }

  function fmt(t) {
    if (t == null || Number.isNaN(t)) return '—';
    const s = Math.max(0, t);
    const m = Math.floor(s / 60);
    const r = (s - m * 60).toFixed(2).padStart(5, '0');
    return `${m}:${r}`;
  }

  function fmtClock(t) {
    if (t == null || Number.isNaN(t)) return '0:00';
    const s = Math.max(0, Math.floor(t));
    const m = Math.floor(s / 60);
    return `${m}:${String(s % 60).padStart(2, '0')}`;
  }

  function outDur() {
    return ops.totalOutputDuration(manifest?.clips || [], duration);
  }

  function trackWidthPx() {
    return Math.max(320, outDur() * pxPerSec);
  }

  function selectedClip() {
    if (!manifest?.clips?.length) return null;
    if (selectedIdx < 0 || selectedIdx >= manifest.clips.length) selectedIdx = 0;
    return manifest.clips[selectedIdx];
  }

  function syncFieldsFromClip() {
    const c = selectedClip();
    if (!c || !clipInSec || !clipOutSec) return;
    clipInSec.value = String(c.in ?? 0);
    clipOutSec.value = String(c.out ?? (duration ?? 0));
  }

  function applyPlaybackRate() {
    if (editVideo) editVideo.playbackRate = playbackRate;
    if (pipVideo) pipVideo.playbackRate = playbackRate;
  }

  function snapTargets() {
    const targets = new Set([0]);
    const add = (v) => {
      if (Number.isFinite(v)) targets.add(Math.round(v * 1000) / 1000);
    };
    let acc = 0;
    for (const c of manifest.clips) {
      add(acc);
      acc += ops.clipDuration(c, duration);
      add(acc);
    }
    for (const mark of [markIn, markOut]) {
      if (mark == null) continue;
      const idx = ops.findClipAtTime(manifest.clips, mark, duration);
      if (idx >= 0) add(ops.sourceToOutput(manifest.clips, idx, mark, duration));
    }
    return targets;
  }

  function snapTime(t) {
    if (!snapOn || !manifest?.clips?.length) return t;
    const thresh = 8 / pxPerSec;
    let best = t;
    let bestD = thresh;
    for (const e of snapTargets()) {
      const d = Math.abs(e - t);
      if (d < bestD) {
        bestD = d;
        best = e;
      }
    }
    return best;
  }

  function seekOutput(t, { seekVideo = true } = {}) {
    const total = outDur();
    outputTime = Math.max(0, Math.min(Number(t) || 0, Math.max(0, total - 0.001)));
    updatePlayheadUi();
    if (!seekVideo || !manifest?.clips?.length) return;
    const mapped = ops.outputToSource(manifest.clips, outputTime, duration);
    selectedIdx = mapped.index;
    syncingFromTimeline = true;
    if (Number.isFinite(mapped.sourceTime)) editVideo.currentTime = mapped.sourceTime;
    if (playing && manifest.clips[mapped.index]?.freeze) {
      startFreezeHold(mapped.index, mapped.offsetInClip);
    } else {
      cancelFreezeHold();
      if (playing && editVideo.paused) editVideo.play().catch(() => {});
    }
    if (selectedIdx !== renderedSelectedIdx) {
      renderSelectionPanel();
      renderTimeline();
    }
    syncFieldsFromClip();
    editTimeLabel.textContent = `out ${fmt(outputTime)} · src ${fmt(mapped.sourceTime)}`;
    if (tlOutTime) tlOutTime.textContent = `${fmtClock(outputTime)} / ${fmtClock(total)}`;
    requestAnimationFrame(() => { syncingFromTimeline = false; });
  }

  function updatePlayheadUi() {
    const total = outDur() || 1;
    const x = (outputTime / total) * trackWidthPx();
    if (tlPlayhead) tlPlayhead.style.left = `${x}px`;
    drawWavePanel();
  }

  /** Visible output-time window of the wave panel (frozen while dragging so the seek target stays put). */
  function wavePanelWindow() {
    if (draggingWave) return draggingWave.win;
    const total = outDur();
    const dur = total / waveZoom;
    const start = Math.max(0, Math.min(outputTime - dur / 2, total - dur));
    return { start, dur };
  }

  /** Mark In/Out as an output-time span, or null when unset / cut from the timeline. */
  function marksOutputSpan() {
    if (markIn == null && markOut == null) return null;
    const toOutput = (src) => {
      if (src == null) return null;
      const idx = ops.findClipAtTime(manifest.clips, src, duration);
      return idx < 0 ? null : ops.sourceToOutput(manifest.clips, idx, src, duration);
    };
    const a = toOutput(markIn);
    const b = toOutput(markOut);
    if (a == null && b == null) return null;
    const lo = Math.min(a ?? b, b ?? a);
    return { lo, hi: Math.max(a ?? b, b ?? a), open: a == null || b == null };
  }

  function drawWavePanel() {
    if (!wavePanelCanvas || !manifest) return;
    const cssW = wavePanelCanvas.clientWidth;
    const cssH = wavePanelCanvas.clientHeight;
    if (!(cssW > 0) || !(cssH > 0)) return;
    const dpr = window.devicePixelRatio || 1;
    const w = Math.round(cssW * dpr);
    const h = Math.round(cssH * dpr);
    if (wavePanelCanvas.width !== w) wavePanelCanvas.width = w;
    if (wavePanelCanvas.height !== h) wavePanelCanvas.height = h;
    const ctx = wavePanelCanvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cssW, cssH);

    const hasWave = Boolean(waveform?.peaks?.length);
    if (wavePanelEmpty) {
      wavePanelEmpty.hidden = hasWave;
      if (!hasWave) wavePanelEmpty.textContent = urls['audio.mp3'] ? 'Loading wave…' : 'No audio stem';
    }
    if (!hasWave || !manifest.clips?.length) return;
    const win = wavePanelWindow();
    if (!(win.dur > 0)) return;
    const toX = (t) => ((t - win.start) / win.dur) * cssW;

    const span = marksOutputSpan();
    if (span) {
      const x0 = toX(span.lo);
      const x1 = span.open ? x0 : toX(span.hi);
      ctx.fillStyle = 'rgba(240, 201, 74, 0.16)';
      ctx.fillRect(x0, 0, Math.max(2, x1 - x0), cssH);
      ctx.fillStyle = 'rgba(240, 201, 74, 0.7)';
      ctx.fillRect(x0 - 0.5, 0, 1, cssH);
      if (!span.open) ctx.fillRect(x1 - 0.5, 0, 1, cssH);
    }

    const barW = 2;
    const gap = 1;
    const bars = Math.max(1, Math.floor(cssW / (barW + gap)));
    const mid = cssH / 2;
    ctx.fillStyle = 'rgba(255, 255, 255, 0.08)';
    ctx.fillRect(0, mid - 0.5, cssW, 1);
    for (let i = 0; i < bars; i += 1) {
      const t = win.start + ((i + 0.5) / bars) * win.dur;
      const mapped = ops.outputToSource(manifest.clips, t, duration);
      if (!Number.isFinite(mapped.sourceTime)) continue;
      const idx = Math.max(0, Math.min(waveform.peaks.length - 1, Math.floor(mapped.sourceTime * waveform.peaksPerSec)));
      const half = Math.max(1, waveform.peaks[idx] * (mid - 6));
      const inMarks = span && !span.open && t >= span.lo && t <= span.hi;
      ctx.fillStyle = inMarks ? '#9cc8ff' : '#6ea8ff';
      ctx.fillRect(i * (barW + gap), mid - half, barW, half * 2);
    }

    const px = toX(outputTime);
    if (px >= 0 && px <= cssW) {
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(px - 1, 0, 2, cssH);
    }
  }

  function wavePointerToOutput(clientX) {
    const rect = wavePanelCanvas.getBoundingClientRect();
    const frac = Math.max(0, Math.min(1, (clientX - rect.left) / Math.max(1, rect.width)));
    const win = wavePanelWindow();
    return win.start + frac * win.dur;
  }

  /** Shift-click on the wave: first sets Mark In, second sets Mark Out, third restarts. */
  function setWaveMark(clientX) {
    const mapped = ops.outputToSource(manifest.clips, wavePointerToOutput(clientX), duration);
    if (!Number.isFinite(mapped.sourceTime)) return;
    if (markIn == null || markOut != null) {
      markIn = mapped.sourceTime;
      markOut = null;
      setStatus(`Mark In ${fmt(markIn)} · ${marksHint()} · Shift-click again for Mark Out`, 'ok');
    } else {
      markOut = mapped.sourceTime;
      setStatus(`Mark Out ${fmt(markOut)} · ${marksHint()} · Cut range to ripple-delete In→Out`, 'ok');
    }
    drawWavePanel();
  }

  function setWaveZoom(z) {
    waveZoom = Math.max(1, Math.min(16, Number(z) || 1));
    drawWavePanel();
    setStatus(waveZoom === 1 ? 'Wave: full take' : `Wave zoom ${waveZoom}× around playhead`);
  }

  function renderRuler() {
    if (!tlRuler) return;
    tlRuler.innerHTML = '';
    const total = outDur();
    const width = trackWidthPx();
    tlRuler.style.width = `${width}px`;
    if (total <= 0) return;
    const step = total > 60 ? 10 : total > 20 ? 5 : total > 8 ? 2 : 1;
    for (let t = 0; t <= total + 0.01; t += step) {
      const span = document.createElement('span');
      span.textContent = fmtClock(t);
      span.style.left = `${(t / total) * width}px`;
      tlRuler.appendChild(span);
    }
  }

  function fakeWaveBars(n) {
    const wrap = document.createElement('div');
    wrap.className = 'wave';
    for (let i = 0; i < n; i += 1) {
      const b = document.createElement('b');
      const h = 20 + Math.abs(Math.sin(i * 0.7)) * 70;
      b.style.height = `${h}%`;
      wrap.appendChild(b);
    }
    return wrap;
  }

  function filmStrip(n) {
    const wrap = document.createElement('div');
    wrap.className = 'film';
    for (let i = 0; i < n; i += 1) {
      wrap.appendChild(document.createElement('i'));
    }
    return wrap;
  }

  function filmStripEl(laneId, clip, widthPx) {
    const strip = filmstrips[laneId];
    const dur = ops.clipDuration(clip, duration);
    if (!strip?.frames?.length || !(dur > 0)) return filmStrip(Math.max(3, Math.floor(dur * 2)));
    const wrap = document.createElement('div');
    wrap.className = 'film';
    const count = Math.max(1, Math.round(widthPx / 72));
    const start = Number(clip.in) || 0;
    for (let i = 0; i < count; i += 1) {
      // A freeze segment shows its single held frame across the whole span.
      const srcT = clip.freeze ? start : start + ((i + 0.5) / count) * dur;
      const idx = Math.max(0, Math.min(strip.frames.length - 1, Math.floor(srcT / strip.intervalSec)));
      const tile = document.createElement('i');
      tile.className = 'thumb';
      tile.style.backgroundImage = `url("${strip.frames[idx]}")`;
      wrap.appendChild(tile);
    }
    return wrap;
  }

  function waveBarsEl(clip, widthPx) {
    const dur = ops.clipDuration(clip, duration);
    if (!waveform?.peaks?.length || !(dur > 0)) return fakeWaveBars(Math.max(8, Math.floor(dur * 4)));
    const wrap = document.createElement('div');
    wrap.className = 'wave';
    const bars = Math.max(8, Math.floor(widthPx / 3));
    const start = Number(clip.in) || 0;
    for (let i = 0; i < bars; i += 1) {
      const srcT = clip.freeze ? start : start + ((i + 0.5) / bars) * dur;
      const idx = Math.max(0, Math.min(waveform.peaks.length - 1, Math.floor(srcT * waveform.peaksPerSec)));
      const b = document.createElement('b');
      b.style.height = `${Math.round(8 + waveform.peaks[idx] * 92)}%`;
      wrap.appendChild(b);
    }
    return wrap;
  }

  function recomputeChips() {
    chips = gapChips
      ? gapChips.buildChips({
        peaks: waveform?.peaks,
        peaksPerSec: waveform?.peaksPerSec,
        cues: transcriptCues,
      })
      : [];
  }

  function renderChipsRow() {
    if (!tlChips) return;
    tlChips.innerHTML = '';
    if (!manifest?.clips?.length || !chips.length) return;
    const total = outDur() || 1;
    const width = trackWidthPx();
    tlChips.style.width = `${width}px`;
    for (const chip of chips) {
      const span = gapChips.chipOutputSpan(manifest.clips, chip.start, chip.end, duration);
      if (!span || span.end - span.start < 0.05) continue;
      const el = document.createElement('button');
      el.type = 'button';
      el.className = `tl-chip ${chip.kind}`;
      el.style.left = `${(span.start / total) * width}px`;
      el.style.width = `${Math.max(8, ((span.end - span.start) / total) * width)}px`;
      el.textContent = chip.label;
      el.title = `${chip.label} · ${fmt(chip.start)} → ${fmt(chip.end)} · click to arm Cut range`;
      el.addEventListener('click', (e) => {
        e.stopPropagation();
        markIn = chip.start;
        markOut = chip.end;
        seekOutput(span.start);
        setStatus(`${chip.kind === 'gap' ? 'Gap' : 'Retake'} ${fmt(chip.start)}–${fmt(chip.end)} armed · ${marksHint()} · Cut range to remove`, 'ok');
      });
      tlChips.appendChild(el);
    }
  }

  function loadTimelineMedia(takeId) {
    filmstrips = { cam: null, screen: null };
    waveform = null;
    const applyIfCurrent = (assign) => (data) => {
      if (currentTakeId !== takeId || !data) return;
      assign(data);
      recomputeChips();
      renderTimeline();
    };
    studio.getFilmstrip(takeId, 'screen.mp4').then(applyIfCurrent((d) => { filmstrips.screen = d; })).catch(() => {});
    if (urls['cam.mp4']) {
      studio.getFilmstrip(takeId, 'cam.mp4').then(applyIfCurrent((d) => { filmstrips.cam = d; })).catch(() => {});
    }
    if (urls['audio.mp3']) {
      studio.getWaveform(takeId).then(applyIfCurrent((d) => { waveform = d; })).catch(() => {});
    }
  }

  function renderTimeline() {
    if (!tlLanes || !manifest) return;
    const total = outDur() || 1;
    const width = trackWidthPx();
    if (tlInner) tlInner.style.width = `${width + 88}px`;
    tlLanes.innerHTML = '';

    LANES.forEach((lane) => {
      const has = Boolean(urls[lane.file]);
      const row = document.createElement('div');
      row.className = `tl-lane ${lane.kind}${has ? '' : ' missing'}`;
      row.innerHTML = `<div class="tl-lane-meta"><strong>${lane.label}</strong><div class="icons">🔒 👁 ${lane.kind === 'audio' ? '🔊' : '🎞'}</div></div>`;
      if (has) {
        const revealBtn = document.createElement('button');
        revealBtn.type = 'button';
        revealBtn.className = 'tl-reveal';
        revealBtn.title = `Open ${lane.file} location`;
        revealBtn.textContent = '📂';
        revealBtn.addEventListener('click', () => {
          if (currentTakeId) studio.revealStem(currentTakeId, lane.file).catch(() => {});
        });
        row.querySelector('.icons')?.appendChild(revealBtn);
      }
      const track = document.createElement('div');
      track.className = 'tl-track';
      track.style.width = `${width}px`;
      track.dataset.lane = lane.id;
      const clipsEl = document.createElement('div');
      clipsEl.className = 'tl-clips';

      manifest.clips.forEach((clip, idx) => {
        const dur = ops.clipDuration(clip, duration);
        const clipW = (dur / total) * width;
        const el = document.createElement('div');
        el.className = `tl-clip ${lane.id}${clip.freeze ? ' freeze' : ''}${idx === selectedIdx ? ' selected' : ''}${has ? '' : ' missing'}`;
        el.style.flex = `0 0 ${clipW}px`;
        el.title = clip.freeze
          ? `${lane.label} · freeze frame ${fmt(clip.in)} · hold ${dur.toFixed(2)}s`
          : `${lane.label} · ${fmt(clip.in)} → ${fmt(clip.out)}`;
        if (lane.kind === 'audio') el.appendChild(waveBarsEl(clip, clipW));
        else el.appendChild(filmStripEl(lane.id, clip, clipW));
        const label = document.createElement('span');
        label.className = 'label';
        label.textContent = clip.freeze ? `❄ #${idx + 1}` : `#${idx + 1}`;
        el.appendChild(label);

        if (idx === selectedIdx && lane.id === 'screen') {
          const left = document.createElement('div');
          left.className = 'tl-handle left';
          const right = document.createElement('div');
          right.className = 'tl-handle right';
          left.addEventListener('pointerdown', (e) => startResize(e, idx, 'left'));
          right.addEventListener('pointerdown', (e) => startResize(e, idx, 'right'));
          el.appendChild(left);
          el.appendChild(right);
        }

        el.addEventListener('click', (e) => {
          if (e.target.classList.contains('tl-handle')) return;
          e.stopPropagation();
          selectClip(idx);
          let acc = 0;
          for (let i = 0; i < idx; i += 1) acc += ops.clipDuration(manifest.clips[i], duration);
          seekOutput(acc + 0.01);
        });
        clipsEl.appendChild(el);
      });

      track.appendChild(clipsEl);
      track.addEventListener('pointerdown', (e) => {
        if (e.target.closest('.tl-clip') || e.target.closest('.tl-handle')) return;
        draggingPlayhead = true;
        track.setPointerCapture(e.pointerId);
        seekOutput(snapTime(pointerToOutput(e.clientX, track)));
      });
      track.addEventListener('pointermove', (e) => {
        if (!draggingPlayhead || resizing) return;
        seekOutput(snapTime(pointerToOutput(e.clientX, track)));
      });
      track.addEventListener('pointerup', () => { draggingPlayhead = false; });
      track.addEventListener('pointercancel', () => { draggingPlayhead = false; });

      row.appendChild(track);
      tlLanes.appendChild(row);
    });

    renderRuler();
    renderChipsRow();
    updatePlayheadUi();
    renderedSelectedIdx = selectedIdx;
  }

  function renderSelectionPanel() {
    if (!clipList || !manifest) return;
    clipList.innerHTML = '';
    if (selectedIdx >= manifest.clips.length) selectedIdx = Math.max(0, manifest.clips.length - 1);
    manifest.clips.forEach((clip, idx) => {
      const row = document.createElement('div');
      row.className = 'clip-row' + (idx === selectedIdx ? ' selected' : '');
      row.innerHTML = `<div class="clip-meta"><strong>${clip.freeze ? '❄ ' : ''}#${idx + 1}${idx === selectedIdx ? ' · selected' : ''}</strong>
        <span>${clip.freeze
    ? `freeze ${fmt(clip.in)} · hold ${ops.clipDuration(clip, duration).toFixed(1)}s`
    : `${fmt(clip.in)} → ${fmt(clip.out)}`}</span></div>`;
      row.addEventListener('click', () => {
        selectClip(idx);
        let acc = 0;
        for (let i = 0; i < idx; i += 1) acc += ops.clipDuration(manifest.clips[i], duration);
        seekOutput(acc + 0.01);
      });
      clipList.appendChild(row);
    });
  }

  function selectClip(idx) {
    if (!manifest?.clips?.length) return;
    selectedIdx = Math.max(0, Math.min(idx, manifest.clips.length - 1));
    renderSelectionPanel();
    renderTimeline();
    syncFieldsFromClip();
    const c = selectedClip();
    setStatus(c.freeze
      ? `Selected #${selectedIdx + 1} · freeze frame ${fmt(c.in)} · hold ${ops.clipDuration(c, duration).toFixed(1)}s`
      : `Selected #${selectedIdx + 1} · ${fmt(c.in)} → ${fmt(c.out)}`);
  }

  function refreshAll() {
    renderSelectionPanel();
    renderTimeline();
    syncFieldsFromClip();
    applyPlaybackRate();
    updatePreviewCrop();
    updatePreviewCamTransform();
    updateCaptionsUi();
    updateExportUi();
    const total = outDur();
    if (tlOutTime) tlOutTime.textContent = `${fmtClock(outputTime)} / ${fmtClock(total)}`;
  }

  function loadPreviewStem() {
    const file = previewStem === 'cam' ? 'cam.mp4' : 'screen.mp4';
    const url = urls[file] || urls['screen.mp4'];
    if (!url) return;
    updatePreviewCamTransform();
    updateCaptionOverlay();
    const keep = editVideo.currentTime || 0;
    const wasPlaying = playing;
    editVideo.src = url;
    editVideo.addEventListener('loadedmetadata', () => {
      applyPlaybackRate();
      if (Number.isFinite(keep)) editVideo.currentTime = keep;
      if (wasPlaying) editVideo.play().catch(() => {});
    }, { once: true });
  }

  async function openEdit(takeId) {
    setStatus('Loading…');
    stopPlay();
    const data = await studio.getTake(takeId);
    currentTakeId = takeId;
    manifest = data.manifest;
    duration = data.duration;
    urls = data.urls || {};
    selectedIdx = 0;
    outputTime = 0;
    editTitle.textContent = takeId;
    const navEdit = document.getElementById('navEdit');
    if (navEdit) navEdit.hidden = false;
    if (!urls['screen.mp4']) {
      setStatus('No screen.mp4 in this take', 'warn');
      return;
    }
    previewStem = 'screen';
    document.querySelectorAll('[data-preview]').forEach((b) => {
      b.classList.toggle('active', b.getAttribute('data-preview') === 'screen');
    });
    loadPreviewStem();
    showView('edit');
    markIn = null;
    markOut = null;
    waveZoom = 1;
    draggingWave = null;
    chips = [];
    transcriptCues = [];
    undoStack?.clear();
    updateUndoUi();
    clipClipboard = null;
    setCropMode(false);
    cropDraft = null;
    refreshAll();
    seekOutput(0);
    loadTimelineMedia(takeId);
    loadTranscript(takeId);
    setStatus(urls['edit/final.mp4']
      ? `Loaded · final exists · ${CUT_PAUSE_HELP}`
      : CUT_PAUSE_HELP);
  }

  function setAsrProvider(provider) {
    asrProvider = provider === 'cloud' ? 'cloud' : 'local';
    sessionStorage.setItem('asrProvider', asrProvider);
    asrLocalBtn?.classList.toggle('active', asrProvider === 'local');
    asrCloudBtn?.classList.toggle('active', asrProvider === 'cloud');
  }

  function seekToCue(cue) {
    if (!manifest?.clips?.length) return;
    const idx = ops.findClipAtTime(manifest.clips, cue.start, duration);
    if (idx < 0) {
      setStatus(`Cue at ${fmt(cue.start)} was cut from the timeline`, 'warn');
      return;
    }
    seekOutput(ops.sourceToOutput(manifest.clips, idx, cue.start, duration));
  }

  function renderTranscript(data) {
    transcriptCues = data?.cues || [];
    recomputeChips();
    renderChipsRow();
    updateCaptionOverlay();
    if (!transcriptPanel) return;
    transcriptPanel.innerHTML = '';
    if (!data || !data.cues?.length) {
      transcriptPanel.innerHTML = '<p class="empty">No transcript yet.</p>';
      return;
    }
    data.cues.forEach((cue, index) => {
      const row = document.createElement('button');
      row.type = 'button';
      row.className = 'cue-row';
      row.title = 'Click to seek · double-click to edit the cue text';
      const time = document.createElement('span');
      time.className = 'cue-time';
      time.textContent = fmt(cue.start);
      const text = document.createElement('span');
      text.className = 'cue-text';
      text.textContent = cue.text;
      row.appendChild(time);
      row.appendChild(text);
      row.addEventListener('click', () => seekToCue(cue));
      row.addEventListener('dblclick', () => startCueEdit(row, cue, index));
      transcriptPanel.appendChild(row);
    });
  }

  /**
   * Edit-T2d light caption edit: double-click a cue → inline input;
   * Enter rewrites edit/captions.vtt (+ transcript.txt) via main, Escape or
   * blur cancels. Timing stays untouched.
   */
  function startCueEdit(row, cue, index) {
    const editor = document.createElement('div');
    editor.className = 'cue-edit';
    const input = document.createElement('input');
    input.type = 'text';
    input.value = cue.text.replace(/\n/g, ' ');
    editor.appendChild(input);
    row.replaceWith(editor);
    input.focus();
    input.select();
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      loadTranscript(currentTakeId);
    };
    input.addEventListener('keydown', async (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        if (done) return;
        done = true;
        try {
          const res = await studio.setCueText(currentTakeId, index, input.value);
          setStatus(`Cue @ ${fmt(cue.start)} updated → captions.vtt (${res.segments} cue${res.segments === 1 ? '' : 's'})`, 'ok');
        } catch (err) {
          setStatus(String(err.message || err), 'warn');
        }
        await loadTranscript(currentTakeId);
      } else if (e.key === 'Escape') {
        e.preventDefault();
        finish();
      }
    });
    input.addEventListener('blur', finish);
  }

  /* —— Edit-T2d: caption burn toggle + preview cue overlay —— */

  function captionsBurnEnabled() {
    return manifest?.captions?.burn === true;
  }

  function updateCaptionsUi() {
    captionsBtn?.classList.toggle('on', captionsBurnEnabled());
    updateCaptionOverlay();
  }

  /**
   * Cheap preview stand-in for the Apply-time burn: the preview <video>
   * plays the source stem (seeks skip cut ranges), so the cue at
   * editVideo.currentTime is the cue Apply burns at that frame.
   */
  function updateCaptionOverlay() {
    if (!captionOverlay) return;
    const t = editVideo?.currentTime || 0;
    const cue = previewStem === 'screen' && captionsBurnEnabled()
      ? transcriptCues.find((c) => t >= c.start && t <= c.end)
      : null;
    captionOverlay.hidden = !cue;
    captionOverlay.textContent = cue ? cue.text : '';
  }

  function doToggleCaptions() {
    if (!manifest) return;
    const next = !captionsBurnEnabled();
    if (next) manifest.captions = { burn: true };
    else delete manifest.captions;
    updateCaptionsUi();
    setStatus(next
      ? (transcriptCues.length
        ? 'Captions on — Apply burns edit/captions.vtt into final.mp4'
        : 'Captions on — run Transcribe first, or Apply skips the burn')
      : 'Captions off — Apply renders without subtitles', next ? 'ok' : '');
  }

  captionsBtn?.addEventListener('click', doToggleCaptions);
  editVideo?.addEventListener('timeupdate', updateCaptionOverlay);
  editVideo?.addEventListener('seeked', updateCaptionOverlay);

  /* —— Edit-T2e: constant export speed + music bed (take-level) —— */

  function updateExportUi() {
    if (exportRateSelect) exportRateSelect.value = String(manifest?.exportRate || 1);
    if (musicBtn) {
      const music = manifest?.music || null;
      musicBtn.classList.toggle('on', Boolean(music));
      musicBtn.title = music
        ? `Music bed: ${music.path.split(/[\\/]/).pop()} @ ${music.gainDb} dB — click to remove`
        : 'Add a music bed — mixed under the dialogue at −18 dB for the whole export on Apply; saved on the take';
    }
  }

  exportRateSelect?.addEventListener('change', () => {
    if (!manifest) return;
    const rate = Number(exportRateSelect.value) || 1;
    if (rate === 1) delete manifest.exportRate;
    else manifest.exportRate = rate;
    updateExportUi();
    setStatus(rate === 1
      ? 'Export speed 1× — final.mp4 keeps real time'
      : `Export speed ${rate}× — Apply renders final.mp4 at ${rate}× (video + audio)`, rate === 1 ? '' : 'ok');
  });

  musicBtn?.addEventListener('click', async () => {
    if (!manifest) return;
    if (manifest.music) {
      delete manifest.music;
      updateExportUi();
      setStatus('Music removed — Apply renders without a bed');
      return;
    }
    const picked = await studio.chooseMusic();
    if (!picked) return;
    manifest.music = { path: picked, gainDb: -18 };
    updateExportUi();
    setStatus(`Music bed: ${picked.split(/[\\/]/).pop()} — mixed at −18 dB under the export on Apply`, 'ok');
  });

  async function loadTranscript(takeId) {
    try {
      renderTranscript(await studio.getTranscript(takeId));
    } catch {
      renderTranscript(null);
    }
  }

  async function doTranscribe() {
    if (!currentTakeId) return;
    transcribeBtn.disabled = true;
    setStatus(`Transcribing (${asrProvider})… first local run downloads the model`);
    try {
      const res = await studio.transcribe({ takeId: currentTakeId, provider: asrProvider });
      await loadTranscript(currentTakeId);
      setStatus(`Transcribed (${res.provider}) → edit/captions.vtt · ${res.segments} cue${res.segments === 1 ? '' : 's'}`, 'ok');
    } catch (e) {
      const msg = String(e.message || e);
      const cloudHint = asrProvider === 'local' && /python|transformers|torch/i.test(msg)
        ? ' Switch to Cloud to use asr.traxelio.com this once.'
        : '';
      setStatus(`${msg}${cloudHint}`, 'warn');
    } finally {
      transcribeBtn.disabled = false;
    }
  }

  /* —— I.2 context menu → Transcribe / transcript —— */

  let ctxMenuEl = null;

  function closeCtxMenu() {
    ctxMenuEl?.remove();
    ctxMenuEl = null;
  }

  let flashTimer = null;

  function focusTranscriptPanel() {
    if (!transcriptPanel) return;
    transcriptPanel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    transcriptPanel.classList.add('flash');
    clearTimeout(flashTimer);
    flashTimer = setTimeout(() => transcriptPanel.classList.remove('flash'), 1200);
  }

  function openCtxMenu(x, y) {
    closeCtxMenu();
    if (!currentTakeId) return;
    const menu = document.createElement('div');
    menu.className = 'ctx-menu';
    menu.setAttribute('role', 'menu');
    const addItem = (label, onClick, disabled) => {
      const item = document.createElement('button');
      item.type = 'button';
      item.setAttribute('role', 'menuitem');
      item.textContent = label;
      item.disabled = Boolean(disabled);
      item.addEventListener('click', () => {
        closeCtxMenu();
        onClick();
      });
      menu.appendChild(item);
      return item;
    };
    let first;
    if (transcriptCues.length) {
      first = addItem('Show transcript', focusTranscriptPanel);
    } else {
      first = addItem(`Transcribe (${asrProvider})`, () => {
        if (transcribeBtn?.disabled) return;
        focusTranscriptPanel();
        doTranscribe();
      });
    }
    const haveClips = Boolean(manifest?.clips?.length);
    addItem(
      `Freeze frame after #${selectedIdx + 1}`,
      doFreeze,
      !haveClips || Boolean(manifest?.clips?.[selectedIdx]?.freeze),
    );
    addItem(`Copy clip #${selectedIdx + 1}`, doCopyClip, !haveClips);
    addItem(`Cut clip #${selectedIdx + 1}`, doCutClipToClipboard, !haveClips || manifest.clips.length <= 1);
    addItem('Paste', doPasteClip, !haveClips || !clipClipboard?.length);
    document.body.appendChild(menu);
    const rect = menu.getBoundingClientRect();
    menu.style.left = `${Math.min(x, window.innerWidth - rect.width - 8)}px`;
    menu.style.top = `${Math.min(y, window.innerHeight - rect.height - 8)}px`;
    ctxMenuEl = menu;
    first.focus();
  }

  [editStage, tlInner, wavePanel].forEach((el) => {
    el?.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      openCtxMenu(e.clientX, e.clientY);
    });
  });
  document.addEventListener('pointerdown', (e) => {
    if (ctxMenuEl && !ctxMenuEl.contains(e.target)) closeCtxMenu();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeCtxMenu();
  });
  window.addEventListener('blur', closeCtxMenu);

  /* —— I.3 screen crop —— */

  function currentCrop() {
    return manifest?.clips?.find((c) => c.crop)?.crop || null;
  }

  /** Letterboxed content box of the video inside the stage (object-fit: contain). */
  function videoContentRect() {
    const stageW = editStage.clientWidth;
    const stageH = editStage.clientHeight;
    const vw = editVideo.videoWidth;
    const vh = editVideo.videoHeight;
    if (!vw || !vh) return { left: 0, top: 0, width: stageW, height: stageH };
    const scale = Math.min(stageW / vw, stageH / vh);
    const w = vw * scale;
    const h = vh * scale;
    return { left: (stageW - w) / 2, top: (stageH - h) / 2, width: w, height: h };
  }

  function layoutCropOverlay() {
    if (!cropMode || !cropOverlay || !cropDraft) return;
    const box = videoContentRect();
    cropOverlay.style.left = `${box.left}px`;
    cropOverlay.style.top = `${box.top}px`;
    cropOverlay.style.width = `${box.width}px`;
    cropOverlay.style.height = `${box.height}px`;
    cropRect.style.left = `${cropDraft.x * 100}%`;
    cropRect.style.top = `${cropDraft.y * 100}%`;
    cropRect.style.width = `${cropDraft.w * 100}%`;
    cropRect.style.height = `${cropDraft.h * 100}%`;
  }

  /** Dim the cropped-out area on the screen preview once a crop is set. */
  function updatePreviewCrop() {
    const crop = currentCrop();
    if (crop && previewStem === 'screen' && !cropMode) {
      const right = Math.max(0, 1 - crop.x - crop.w) * 100;
      const bottom = Math.max(0, 1 - crop.y - crop.h) * 100;
      editVideo.style.clipPath = `inset(${crop.y * 100}% ${right}% ${bottom}% ${crop.x * 100}%)`;
    } else {
      editVideo.style.clipPath = '';
    }
    cropBtn?.classList.toggle('on', Boolean(crop));
  }

  function setCropMode(on) {
    cropMode = on;
    if (cropOverlay) cropOverlay.hidden = !on;
    if (cropActions) cropActions.hidden = !on;
    cropBtn?.classList.toggle('active', on);
    updatePreviewCrop();
    if (on) layoutCropOverlay();
  }

  function enterCropMode() {
    if (!manifest?.clips?.length || !urls['screen.mp4']) return;
    if (previewStem !== 'screen') {
      previewStem = 'screen';
      document.querySelectorAll('[data-preview]').forEach((b) => {
        b.classList.toggle('active', b.getAttribute('data-preview') === 'screen');
      });
      loadPreviewStem();
    }
    stopPlay();
    cropDraft = currentCrop() ? { ...currentCrop() } : { x: 0, y: 0, w: 1, h: 1 };
    setCropMode(true);
    setStatus('Crop: drag the handles around the app window · Done to keep, Clear to remove', 'ok');
  }

  function commitCrop(crop) {
    const prev = snapshot();
    manifest.clips = ops.setCrop(manifest.clips, crop);
    const next = currentCrop();
    if (JSON.stringify(prev.clips) !== JSON.stringify(manifest.clips)) pushUndo(prev);
    setCropMode(false);
    cropDraft = null;
    setStatus(next
      ? `Crop set ${Math.round(next.w * 100)}%×${Math.round(next.h * 100)}% — Apply renders it into final.mp4`
      : 'Crop cleared — full frame on Apply', next ? 'ok' : '');
  }

  function cancelCrop() {
    setCropMode(false);
    cropDraft = null;
    setStatus('Crop unchanged');
  }

  function startCropDrag(e, handle) {
    if (!cropMode || !cropDraft) return;
    e.preventDefault();
    e.stopPropagation();
    const MIN = 0.05;
    const box = videoContentRect();
    const start = { ...cropDraft };
    const x0 = e.clientX;
    const y0 = e.clientY;
    const onMove = (ev) => {
      const dx = (ev.clientX - x0) / Math.max(1, box.width);
      const dy = (ev.clientY - y0) / Math.max(1, box.height);
      const d = { ...start };
      if (handle === 'move') {
        d.x = Math.min(Math.max(start.x + dx, 0), 1 - start.w);
        d.y = Math.min(Math.max(start.y + dy, 0), 1 - start.h);
      } else {
        if (handle.includes('w')) {
          d.x = Math.min(Math.max(start.x + dx, 0), start.x + start.w - MIN);
          d.w = start.w + (start.x - d.x);
        }
        if (handle.includes('e')) {
          d.w = Math.min(Math.max(start.w + dx, MIN), 1 - start.x);
        }
        if (handle.includes('n')) {
          d.y = Math.min(Math.max(start.y + dy, 0), start.y + start.h - MIN);
          d.h = start.h + (start.y - d.y);
        }
        if (handle.includes('s')) {
          d.h = Math.min(Math.max(start.h + dy, MIN), 1 - start.y);
        }
      }
      cropDraft = d;
      layoutCropOverlay();
    };
    const onUp = () => {
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerup', onUp);
    };
    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerup', onUp);
  }

  cropRect?.addEventListener('pointerdown', (e) => {
    const handle = e.target.dataset?.h;
    startCropDrag(e, handle || 'move');
  });
  cropBtn?.addEventListener('click', () => (cropMode ? cancelCrop() : enterCropMode()));
  cropDoneBtn?.addEventListener('click', () => commitCrop(cropDraft));
  cropClearBtn?.addEventListener('click', () => commitCrop(null));
  cropCancelBtn?.addEventListener('click', cancelCrop);
  window.addEventListener('resize', layoutCropOverlay);

  /* —— I.4/I.5 cam mirror + rotate (cam stem only) —— */

  function camMirrored() {
    return Boolean(manifest?.cam?.mirror);
  }

  function camRotation() {
    return manifest?.cam?.rotate || 0;
  }

  /** Edit-T2a: PiP defaults ON when the take has a cam; cam.pip === false is the opt-out. */
  function camPipEnabled() {
    return Boolean(urls['cam.mp4']) && manifest?.cam?.pip !== false;
  }

  /** Merge a patch into take-level cam settings; absent key = no settings. */
  function setCamSettings(patch) {
    const cam = ops.normalizeCam({ ...(manifest.cam || {}), ...patch });
    if (cam) manifest.cam = cam;
    else delete manifest.cam;
  }

  /**
   * Transform only the cam preview; screen (and crop mode) stay untouched.
   * Mirror applies in source space before the rotation — the Edit-T2 ffmpeg
   * equivalent is `hflip` before `transpose` on the cam input.
   */
  function updatePreviewCamTransform() {
    const active = previewStem === 'cam' && Boolean(urls['cam.mp4']);
    const deg = active ? camRotation() : 0;
    const parts = [];
    if (deg) parts.push(`rotate(${deg}deg)`);
    // The stage is a fixed 16:9 box, so a quarter-turn overflows it
    // vertically; 9/16 shrinks the turned frame back inside.
    if (deg === 90 || deg === 270) parts.push('scale(0.5625)');
    if (active && camMirrored()) parts.push('scaleX(-1)');
    if (editVideo) editVideo.style.transform = parts.join(' ');
    const haveCam = Boolean(urls['cam.mp4']);
    if (camMirrorBtn) {
      camMirrorBtn.disabled = !haveCam;
      camMirrorBtn.classList.toggle('on', camMirrored());
    }
    if (camRotateBtn) {
      camRotateBtn.disabled = !haveCam;
      camRotateBtn.classList.toggle('on', camRotation() !== 0);
      camRotateBtn.textContent = camRotation() ? `Rotate ${camRotation()}°` : 'Rotate';
    }
    if (camPipBtn) {
      camPipBtn.disabled = !haveCam;
      camPipBtn.classList.toggle('on', camPipEnabled());
    }
    updatePipPreview();
  }

  /**
   * CSS stand-in for the Apply-time PiP: while previewing the screen with PiP
   * enabled, show the cam (mirror/rotate applied) in the same corner. Muted —
   * it only shadows the main preview's clock.
   */
  function updatePipPreview() {
    if (!pipVideo) return;
    const show = previewStem === 'screen' && camPipEnabled();
    pipVideo.hidden = !show;
    if (!show) {
      if (!pipVideo.paused) pipVideo.pause();
      layoutPipPreview();
      return;
    }
    if (pipVideo.getAttribute('src') !== urls['cam.mp4']) {
      pipVideo.setAttribute('src', urls['cam.mp4']);
    }
    const parts = [];
    const deg = camRotation();
    if (deg) parts.push(`rotate(${deg}deg)`);
    if (deg === 90 || deg === 270) parts.push('scale(0.5625)');
    if (camMirrored()) parts.push('scaleX(-1)');
    pipVideo.style.transform = parts.join(' ');
    layoutPipPreview();
    syncPipClock();
  }

  /* —— Edit-T2b: draggable PiP layout (position + size), persisted on the take —— */

  let pipDraft = null; // in-flight drag rect { x, y, w }, normalized to the output frame

  function pipLayoutValue() {
    return manifest?.cam?.pipLayout || null;
  }

  /**
   * The output frame inside the stage: the letterboxed screen content box,
   * narrowed to the crop region when a crop is set — Apply overlays the PiP
   * after the crop, so layout coords are relative to the cropped base.
   */
  function pipFrameRect() {
    const box = videoContentRect();
    const crop = currentCrop();
    if (!crop) return box;
    return {
      left: box.left + crop.x * box.width,
      top: box.top + crop.y * box.height,
      width: crop.w * box.width,
      height: crop.h * box.height,
    };
  }

  /** Current on-screen PiP rect as a normalized layout (untransformed box). */
  function measurePipLayout() {
    const frame = pipFrameRect();
    if (!frame.width || !frame.height) return null;
    return {
      x: (pipVideo.offsetLeft - frame.left) / frame.width,
      y: (pipVideo.offsetTop - frame.top) / frame.height,
      w: pipVideo.offsetWidth / frame.width,
    };
  }

  /** Position the PiP box (and its resize handle) from the draft or saved layout. */
  function layoutPipPreview() {
    if (!pipVideo) return;
    if (pipVideo.hidden) {
      if (pipHandle) pipHandle.hidden = true;
      return;
    }
    const layout = pipDraft || pipLayoutValue();
    if (layout) {
      const frame = pipFrameRect();
      pipVideo.style.right = 'auto';
      pipVideo.style.bottom = 'auto';
      pipVideo.style.left = `${frame.left + layout.x * frame.width}px`;
      pipVideo.style.top = `${frame.top + layout.y * frame.height}px`;
      pipVideo.style.width = `${layout.w * frame.width}px`;
    } else {
      pipVideo.style.left = '';
      pipVideo.style.top = '';
      pipVideo.style.right = '';
      pipVideo.style.bottom = '';
      pipVideo.style.width = '';
    }
    if (pipHandle) {
      pipHandle.hidden = false;
      pipHandle.style.left = `${pipVideo.offsetLeft + pipVideo.offsetWidth - 7}px`;
      pipHandle.style.top = `${pipVideo.offsetTop + pipVideo.offsetHeight - 7}px`;
    }
  }

  function startPipDrag(e, mode) {
    if (!manifest || pipVideo.hidden) return;
    e.preventDefault();
    const frame = pipFrameRect();
    if (!frame.width || !frame.height) return;
    const start = pipDraft ? { ...pipDraft } : (pipLayoutValue() || measurePipLayout());
    if (!start) return;
    const startHFrac = (pipVideo.offsetHeight / frame.height) || (start.w * 0.75);
    const x0 = e.clientX;
    const y0 = e.clientY;
    const MIN_W = 0.1;
    const MAX_W = 0.8;
    let moved = false;
    const onMove = (ev) => {
      moved = true;
      const dx = (ev.clientX - x0) / frame.width;
      const dy = (ev.clientY - y0) / frame.height;
      const d = { ...start };
      if (mode === 'resize') d.w = Math.min(Math.max(start.w + dx, MIN_W), MAX_W);
      else {
        d.x = start.x + dx;
        d.y = start.y + dy;
      }
      const hFrac = startHFrac * (d.w / start.w);
      d.x = Math.min(Math.max(d.x, 0), Math.max(0, 1 - d.w));
      d.y = Math.min(Math.max(d.y, 0), Math.max(0, 1 - hFrac));
      pipDraft = d;
      layoutPipPreview();
    };
    const onUp = () => {
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerup', onUp);
      if (moved) commitPipLayout();
      else pipDraft = null;
    };
    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerup', onUp);
  }

  function commitPipLayout() {
    if (!pipDraft || !manifest) return;
    const prev = snapshot();
    setCamSettings({ pipLayout: pipDraft });
    pipDraft = null;
    pushUndo(prev);
    layoutPipPreview();
    setStatus('Cam PiP layout saved on the take — Apply renders it at this spot and size', 'ok');
  }

  pipVideo?.addEventListener('pointerdown', (e) => startPipDrag(e, 'move'));
  pipHandle?.addEventListener('pointerdown', (e) => startPipDrag(e, 'resize'));
  pipVideo?.addEventListener('loadedmetadata', layoutPipPreview);
  window.addEventListener('resize', layoutPipPreview);

  /** Keep the PiP shadow within ~0.3s of the main preview (linked stems). */
  function syncPipClock() {
    if (!pipVideo || pipVideo.hidden || !editVideo) return;
    if (Math.abs((pipVideo.currentTime || 0) - (editVideo.currentTime || 0)) > 0.3) {
      pipVideo.currentTime = editVideo.currentTime || 0;
    }
    if (editVideo.paused) {
      if (!pipVideo.paused) pipVideo.pause();
    } else if (pipVideo.paused) {
      pipVideo.play().catch(() => {});
    }
  }

  editVideo?.addEventListener('play', syncPipClock);
  editVideo?.addEventListener('pause', syncPipClock);
  editVideo?.addEventListener('seeked', syncPipClock);
  editVideo?.addEventListener('timeupdate', syncPipClock);

  function switchPreviewToCam() {
    if (previewStem === 'cam') return;
    previewStem = 'cam';
    document.querySelectorAll('[data-preview]').forEach((b) => {
      b.classList.toggle('active', b.getAttribute('data-preview') === 'cam');
    });
    loadPreviewStem();
  }

  function doToggleCamMirror() {
    if (!manifest || !urls['cam.mp4']) return;
    const prev = snapshot();
    const next = !camMirrored();
    setCamSettings({ mirror: next });
    pushUndo(prev);
    if (next) switchPreviewToCam();
    updatePreviewCamTransform();
    setStatus(next
      ? 'Cam mirrored (selfie flip) — saved on the take · rendered on the cam PiP at Apply'
      : 'Cam mirror off', next ? 'ok' : '');
  }

  function doRotateCam() {
    if (!manifest || !urls['cam.mp4']) return;
    const prev = snapshot();
    const deg = (camRotation() + 90) % 360;
    setCamSettings({ rotate: deg });
    pushUndo(prev);
    switchPreviewToCam();
    updatePreviewCamTransform();
    setStatus(deg
      ? `Cam rotated ${deg}° — saved on the take · rendered on the cam PiP at Apply`
      : 'Cam rotation off', deg ? 'ok' : '');
  }

  function doToggleCamPip() {
    if (!manifest || !urls['cam.mp4']) return;
    const prev = snapshot();
    const next = !camPipEnabled();
    setCamSettings({ pip: next });
    pushUndo(prev);
    updatePreviewCamTransform();
    setStatus(next
      ? 'Cam PiP on — Apply overlays cam bottom-right in final.mp4'
      : 'Cam PiP off — Apply renders screen only', next ? 'ok' : '');
  }

  camMirrorBtn?.addEventListener('click', doToggleCamMirror);
  camRotateBtn?.addEventListener('click', doRotateCam);
  camPipBtn?.addEventListener('click', doToggleCamPip);

  function snapshot() {
    return {
      clips: manifest.clips.map((c) => ({ ...c })),
      selectedIdx,
      cam: manifest.cam ? { ...manifest.cam } : null,
    };
  }

  function updateUndoUi() {
    if (undoBtn) undoBtn.disabled = !undoStack?.canUndo();
    if (redoBtn) redoBtn.disabled = !undoStack?.canRedo();
  }

  function pushUndo(prev) {
    if (!undoStack) return;
    undoStack.push(prev);
    updateUndoUi();
  }

  function restoreSnapshot(snap) {
    manifest.clips = snap.clips.map((c) => ({ ...c }));
    if (snap.cam) manifest.cam = { ...snap.cam };
    else delete manifest.cam;
    selectedIdx = Math.max(0, Math.min(snap.selectedIdx ?? 0, manifest.clips.length - 1));
    refreshAll();
    seekOutput(Math.min(outputTime, Math.max(0, outDur() - 0.01)));
    updateUndoUi();
  }

  function doUndo() {
    if (!undoStack || !manifest?.clips) return;
    const snap = undoStack.undo(snapshot());
    if (!snap) {
      setStatus('Nothing to undo');
      return;
    }
    restoreSnapshot(snap);
    setStatus(`Undo → ${manifest.clips.length} clip${manifest.clips.length === 1 ? '' : 's'}`, 'ok');
  }

  function doRedo() {
    if (!undoStack || !manifest?.clips) return;
    const snap = undoStack.redo(snapshot());
    if (!snap) {
      setStatus('Nothing to redo');
      return;
    }
    restoreSnapshot(snap);
    setStatus(`Redo → ${manifest.clips.length} clip${manifest.clips.length === 1 ? '' : 's'}`, 'ok');
  }

  function doSplit() {
    const prev = snapshot();
    try {
      const mapped = ops.outputToSource(manifest.clips, outputTime, duration);
      manifest.clips = ops.splitAt(manifest.clips, mapped.index, mapped.sourceTime, duration);
      pushUndo(prev);
      selectedIdx = mapped.index;
      refreshAll();
      seekOutput(outputTime);
      setStatus(
        `Split at ${fmt(mapped.sourceTime)} → ${manifest.clips.length} clips · next: Split @ B or Delete middle`,
        'ok',
      );
    } catch (e) {
      setStatus(String(e.message || e), 'warn');
    }
  }

  function doCut() {
    const prev = snapshot();
    try {
      manifest.clips = ops.cutClip(manifest.clips, selectedIdx);
      pushUndo(prev);
      if (selectedIdx >= manifest.clips.length) selectedIdx = manifest.clips.length - 1;
      refreshAll();
      seekOutput(Math.min(outputTime, Math.max(0, outDur() - 0.01)));
      setStatus(
        magnetOn
          ? 'Deleted middle · ripple join (pause cut)'
          : 'Deleted selected clip',
        'ok',
      );
    } catch (e) {
      setStatus(String(e.message || e), 'warn');
    }
  }

  function doMarkIn() {
    if (!manifest?.clips?.length) return;
    const mapped = ops.outputToSource(manifest.clips, outputTime, duration);
    markIn = mapped.sourceTime;
    drawWavePanel();
    setStatus(`Mark In ${fmt(markIn)} · ${marksHint()} · set Mark Out then Cut range`, 'ok');
  }

  function doMarkOut() {
    if (!manifest?.clips?.length) return;
    const mapped = ops.outputToSource(manifest.clips, outputTime, duration);
    markOut = mapped.sourceTime;
    drawWavePanel();
    setStatus(`Mark Out ${fmt(markOut)} · ${marksHint()} · Cut range to ripple-delete In→Out`, 'ok');
  }

  function doCutRange() {
    if (markIn == null || markOut == null) {
      setStatus('Set Mark In and Mark Out first (or Split @ A · Split @ B · Delete middle)', 'warn');
      return;
    }
    const a = Math.min(markIn, markOut);
    const b = Math.max(markIn, markOut);
    const prev = snapshot();
    try {
      manifest.clips = ops.cutRange(manifest.clips, a, b, duration);
      pushUndo(prev);
      if (selectedIdx >= manifest.clips.length) selectedIdx = Math.max(0, manifest.clips.length - 1);
      markIn = null;
      markOut = null;
      refreshAll();
      seekOutput(Math.min(outputTime, Math.max(0, outDur() - 0.01)));
      setStatus(`Cut range ${fmt(a)}–${fmt(b)} · ripple join`, 'ok');
    } catch (e) {
      setStatus(String(e.message || e), 'warn');
    }
  }

  /* —— I.6 clip clipboard: copy / cut / paste within the take —— */

  function doCopyClip() {
    if (!manifest?.clips?.length) return;
    try {
      clipClipboard = ops.copySlice(manifest.clips, selectedIdx, 1);
      const c = clipClipboard[0];
      setStatus(`Copied #${selectedIdx + 1} · ${fmt(c.in)} → ${fmt(c.out)} · Paste inserts after the playhead clip`, 'ok');
    } catch (e) {
      setStatus(String(e.message || e), 'warn');
    }
  }

  function doCutClipToClipboard() {
    if (!manifest?.clips?.length) return;
    const prev = snapshot();
    try {
      const copied = ops.copySlice(manifest.clips, selectedIdx, 1);
      manifest.clips = ops.cutClip(manifest.clips, selectedIdx);
      clipClipboard = copied;
      pushUndo(prev);
      if (selectedIdx >= manifest.clips.length) selectedIdx = manifest.clips.length - 1;
      refreshAll();
      seekOutput(Math.min(outputTime, Math.max(0, outDur() - 0.01)));
      setStatus(`Cut #${prev.selectedIdx + 1} to clipboard · ripple join · Paste to re-insert`, 'ok');
    } catch (e) {
      setStatus(String(e.message || e), 'warn');
    }
  }

  function doPasteClip() {
    if (!manifest?.clips?.length) return;
    if (!clipClipboard?.length) {
      setStatus('Clipboard empty — Copy or Cut a clip first', 'warn');
      return;
    }
    const prev = snapshot();
    try {
      const at = ops.outputToSource(manifest.clips, outputTime, duration).index;
      const res = ops.pasteAfter(manifest.clips, clipClipboard, at);
      manifest.clips = res.clips;
      pushUndo(prev);
      selectedIdx = res.firstPastedIndex;
      refreshAll();
      let acc = 0;
      for (let i = 0; i < res.firstPastedIndex; i += 1) acc += ops.clipDuration(manifest.clips[i], duration);
      seekOutput(acc + 0.01);
      setStatus(`Pasted after #${at + 1} → ${manifest.clips.length} clips · ripple shift`, 'ok');
    } catch (e) {
      setStatus(String(e.message || e), 'warn');
    }
  }

  /* —— Edit-T2c freeze: insert + play a held-frame segment —— */

  const FREEZE_DEFAULT_SEC = 1.5;
  let freezeRaf = null;

  function cancelFreezeHold() {
    if (freezeRaf != null) cancelAnimationFrame(freezeRaf);
    freezeRaf = null;
  }

  /**
   * Play a freeze segment: park the video on the held frame and advance the
   * playhead by wall clock (× rate) until the segment's output span elapses,
   * then continue into the next clip.
   */
  function startFreezeHold(idx, offsetInClip) {
    cancelFreezeHold();
    const clip = manifest.clips[idx];
    const dur = ops.clipDuration(clip, duration);
    let acc = 0;
    for (let i = 0; i < idx; i += 1) acc += ops.clipDuration(manifest.clips[i], duration);
    syncingFromTimeline = true;
    editVideo.pause();
    editVideo.currentTime = Number(clip.in) || 0;
    requestAnimationFrame(() => { syncingFromTimeline = false; });
    let offset = Math.max(0, Number(offsetInClip) || 0);
    let last = performance.now();
    const step = (now) => {
      if (!playing || !manifest?.clips?.length) {
        freezeRaf = null;
        return;
      }
      offset += ((now - last) / 1000) * playbackRate;
      last = now;
      if (offset >= dur) {
        freezeRaf = null;
        if (idx < manifest.clips.length - 1) {
          advanceToClip(idx + 1);
        } else {
          outputTime = Math.max(0, outDur() - 0.001);
          updatePlayheadUi();
          stopPlay();
        }
        return;
      }
      outputTime = acc + offset;
      updatePlayheadUi();
      editTimeLabel.textContent = `out ${fmt(outputTime)} · src ${fmt(clip.in)} · freeze`;
      if (tlOutTime) tlOutTime.textContent = `${fmtClock(outputTime)} / ${fmtClock(outDur())}`;
      freezeRaf = requestAnimationFrame(step);
    };
    freezeRaf = requestAnimationFrame(step);
  }

  /** Continue playback in clips[idx]: seek + play for a real clip, hold for a freeze. */
  function advanceToClip(idx) {
    selectedIdx = idx;
    const clip = manifest.clips[idx];
    if (clip.freeze) {
      startFreezeHold(idx, 0);
      refreshAll();
      return;
    }
    syncingFromTimeline = true;
    editVideo.currentTime = clip.in || 0;
    if (editVideo.paused) editVideo.play().catch(() => {});
    refreshAll();
    requestAnimationFrame(() => { syncingFromTimeline = false; });
  }

  function doFreeze() {
    if (!manifest?.clips?.length) return;
    const prev = snapshot();
    try {
      const res = ops.insertFreezeAfter(manifest.clips, selectedIdx, FREEZE_DEFAULT_SEC, duration);
      manifest.clips = res.clips;
      pushUndo(prev);
      selectedIdx = res.freezeIndex;
      refreshAll();
      let acc = 0;
      for (let i = 0; i < res.freezeIndex; i += 1) acc += ops.clipDuration(manifest.clips[i], duration);
      seekOutput(acc + 0.01);
      setStatus(`Freeze ${FREEZE_DEFAULT_SEC}s after #${res.freezeIndex} — holds the clip's last frame · drag its edges to adjust · Apply renders the still`, 'ok');
    } catch (e) {
      setStatus(String(e.message || e), 'warn');
    }
  }

  function stopPlay() {
    playing = false;
    cancelFreezeHold();
    editVideo.pause();
    if (tlPlayBtn) tlPlayBtn.textContent = 'Play';
  }

  function togglePlay() {
    if (playing) {
      stopPlay();
      return;
    }
    playing = true;
    if (tlPlayBtn) tlPlayBtn.textContent = 'Pause';
    applyPlaybackRate();
    const mapped = ops.outputToSource(manifest.clips, outputTime, duration);
    if (manifest.clips[mapped.index]?.freeze) {
      selectedIdx = mapped.index;
      startFreezeHold(mapped.index, mapped.offsetInClip);
      return;
    }
    editVideo.currentTime = mapped.sourceTime;
    editVideo.play().catch(() => stopPlay());
  }

  function startResize(e, index, edge) {
    e.preventDefault();
    e.stopPropagation();
    resizing = { index, edge, startX: e.clientX, prev: snapshot() };
    e.currentTarget.classList.add('active');
    e.currentTarget.setPointerCapture(e.pointerId);
    const onMove = (ev) => {
      if (!resizing) return;
      const dx = ev.clientX - resizing.startX;
      const dt = dx / pxPerSec;
      const c = manifest.clips[resizing.index];
      const start = Number(c.in) || 0;
      const end = ops.clipEnd(c, duration);
      try {
        if (resizing.edge === 'left') {
          manifest.clips = ops.trimClip(manifest.clips, index, start + dt, end, duration);
        } else {
          manifest.clips = ops.trimClip(manifest.clips, index, start, end + dt, duration);
        }
        resizing.startX = ev.clientX;
        refreshAll();
        const mapped = ops.outputToSource(manifest.clips, outputTime, duration);
        syncingFromTimeline = true;
        editVideo.currentTime = mapped.sourceTime;
        requestAnimationFrame(() => { syncingFromTimeline = false; });
      } catch (_) { /* too short */ }
    };
    const onUp = () => {
      const prev = resizing?.prev;
      resizing = null;
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerup', onUp);
      if (prev && JSON.stringify(prev.clips) !== JSON.stringify(manifest.clips)) pushUndo(prev);
      setStatus(`Trimmed #${index + 1}`, 'ok');
    };
    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerup', onUp);
  }

  editVideo?.addEventListener('timeupdate', () => {
    // During a freeze hold the rAF loop owns the playhead; stray video
    // events must not snap it back to the segment start.
    if (freezeRaf != null) return;
    if (syncingFromTimeline || draggingPlayhead || resizing || !manifest?.clips?.length) return;
    const src = editVideo.currentTime;
    const c = selectedClip();
    if (!c || c.freeze) return;
    const end = ops.clipEnd(c, duration);
    if (playing && end != null && src >= end - 0.04) {
      if (selectedIdx < manifest.clips.length - 1) {
        advanceToClip(selectedIdx + 1);
        if (manifest.clips[selectedIdx].freeze) return;
      } else {
        stopPlay();
      }
    }
    outputTime = ops.sourceToOutput(manifest.clips, selectedIdx, src, duration);
    updatePlayheadUi();
    if (tlOutTime) tlOutTime.textContent = `${fmtClock(outputTime)} / ${fmtClock(outDur())}`;
    editTimeLabel.textContent = `out ${fmt(outputTime)} · src ${fmt(src)}`;
  });

  editVideo?.addEventListener('loadedmetadata', () => {
    if (Number.isFinite(editVideo.duration) && editVideo.duration > 0 && previewStem === 'screen') {
      duration = editVideo.duration;
    }
    applyPlaybackRate();
    refreshAll();
    seekOutput(outputTime);
    layoutCropOverlay();
  });

  editVideo?.addEventListener('ended', stopPlay);

  function pointerToOutput(clientX, trackEl) {
    const el = trackEl || tlPlayheadLayer;
    const rect = el.getBoundingClientRect();
    const x = Math.max(0, Math.min(clientX - rect.left, rect.width));
    const total = outDur() || 1;
    return (x / Math.max(1, trackWidthPx())) * total;
  }

  function bindPlayheadDrag(el) {
    el?.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      draggingPlayhead = true;
      el.setPointerCapture(e.pointerId);
      seekOutput(snapTime(pointerToOutput(e.clientX, tlPlayheadLayer)));
    });
    el?.addEventListener('pointermove', (e) => {
      if (!draggingPlayhead || resizing) return;
      seekOutput(snapTime(pointerToOutput(e.clientX, tlPlayheadLayer)));
    });
    el?.addEventListener('pointerup', () => { draggingPlayhead = false; });
    el?.addEventListener('pointercancel', () => { draggingPlayhead = false; });
  }
  bindPlayheadDrag(tlPlayheadCap);
  bindPlayheadDrag(tlPlayheadLayer);

  wavePanel?.addEventListener('pointerdown', (e) => {
    if (e.target.closest('.wave-panel-zoom') || !manifest?.clips?.length) return;
    e.preventDefault();
    if (e.shiftKey) {
      setWaveMark(e.clientX);
      return;
    }
    draggingWave = { win: wavePanelWindow() };
    wavePanel.setPointerCapture(e.pointerId);
    seekOutput(wavePointerToOutput(e.clientX));
  });
  wavePanel?.addEventListener('pointermove', (e) => {
    if (!draggingWave) return;
    seekOutput(wavePointerToOutput(e.clientX));
  });
  wavePanel?.addEventListener('pointerup', () => { draggingWave = null; drawWavePanel(); });
  wavePanel?.addEventListener('pointercancel', () => { draggingWave = null; drawWavePanel(); });
  waveZoomInBtn?.addEventListener('click', () => setWaveZoom(waveZoom * 2));
  waveZoomOutBtn?.addEventListener('click', () => setWaveZoom(waveZoom / 2));
  window.addEventListener('resize', () => drawWavePanel());

  tlPlayBtn?.addEventListener('click', togglePlay);
  undoBtn?.addEventListener('click', doUndo);
  redoBtn?.addEventListener('click', doRedo);
  splitBtn?.addEventListener('click', doSplit);
  freezeBtn?.addEventListener('click', doFreeze);
  cutBtn?.addEventListener('click', doCut);
  markInBtn?.addEventListener('click', doMarkIn);
  markOutBtn?.addEventListener('click', doMarkOut);
  cutRangeBtn?.addEventListener('click', doCutRange);
  transcribeBtn?.addEventListener('click', doTranscribe);
  asrLocalBtn?.addEventListener('click', () => setAsrProvider('local'));
  asrCloudBtn?.addEventListener('click', () => setAsrProvider('cloud'));
  setAsrProvider(asrProvider);

  magnetBtn?.addEventListener('click', () => {
    magnetOn = !magnetOn;
    magnetBtn.classList.toggle('on', magnetOn);
    setStatus(magnetOn ? 'Magnet ON — delete ripples' : 'Magnet OFF (gaps still excluded for v1)');
  });
  snapBtn?.addEventListener('click', () => {
    snapOn = !snapOn;
    snapBtn.classList.toggle('on', snapOn);
    setStatus(snapOn ? 'Snap ON' : 'Snap OFF');
  });

  rateSelect?.addEventListener('change', () => {
    playbackRate = Number(rateSelect.value) || 1;
    applyPlaybackRate();
    setStatus(`Preview ${playbackRate}×`);
  });

  function setZoom(v) {
    pxPerSec = Math.max(40, Math.min(240, Number(v) || 100));
    if (zoomRange) zoomRange.value = String(pxPerSec);
    refreshAll();
  }
  zoomRange?.addEventListener('input', () => setZoom(zoomRange.value));
  zoomInBtn?.addEventListener('click', () => setZoom(pxPerSec + 20));
  zoomOutBtn?.addEventListener('click', () => setZoom(pxPerSec - 20));

  setClipRangeBtn?.addEventListener('click', () => {
    const inn = Number(clipInSec.value);
    const out = Number(clipOutSec.value);
    const prev = snapshot();
    try {
      manifest.clips = ops.trimClip(manifest.clips, selectedIdx, inn, out, duration);
      pushUndo(prev);
      refreshAll();
      seekOutput(ops.sourceToOutput(manifest.clips, selectedIdx, inn, duration));
      setStatus(`Trimmed #${selectedIdx + 1} → ${fmt(inn)}–${fmt(out)}`, 'ok');
    } catch (e) {
      setStatus(String(e.message || e), 'warn');
    }
  });

  saveManifestBtn?.addEventListener('click', async () => {
    try {
      const res = await studio.saveManifest(currentTakeId, manifest);
      manifest = res.manifest;
      refreshAll();
      setStatus('Saved edit/manifest.json', 'ok');
    } catch (e) {
      setStatus(String(e.message || e), 'warn');
    }
  });

  applyBtn?.addEventListener('click', async () => {
    try {
      stopPlay();
      setStatus('Applying locally (ffmpeg)…');
      applyBtn.disabled = true;
      await studio.saveManifest(currentTakeId, manifest);
      const res = await studio.apply(currentTakeId);
      const captionNote = res.captions
        ? ' · captions burned'
        : (res.captionsSkipped ? ` · captions skipped: ${res.captionsSkipped}` : '');
      const rateNote = res.rate && res.rate !== 1 ? ` · ${res.rate}×` : '';
      const musicNote = res.music
        ? ' · music bed'
        : (res.musicSkipped ? ` · music skipped: ${res.musicSkipped}` : '');
      setStatus(`Applied → edit/final.mp4 (${res.clips} clip${res.clips === 1 ? '' : 's'}${res.freeze ? ` · ${res.freeze} freeze` : ''}${res.pip ? ' · cam PiP' : ''}${captionNote}${rateNote}${musicNote})`, (res.captionsSkipped || res.musicSkipped) ? 'warn' : 'ok');
    } catch (e) {
      setStatus(String(e.message || e), 'warn');
    } finally {
      applyBtn.disabled = false;
    }
  });

  openFolderBtn?.addEventListener('click', () => {
    if (currentTakeId) studio.openTakeFolder(currentTakeId);
  });
  backLibraryBtn?.addEventListener('click', () => { stopPlay(); showView('library'); });

  const tlMoreBtn = document.getElementById('tlMoreBtn');
  const tlMoreMenu = document.getElementById('tlMoreMenu');
  const setMoreOpen = (open) => {
    if (!tlMoreBtn || !tlMoreMenu) return;
    tlMoreMenu.hidden = !open;
    tlMoreBtn.setAttribute('aria-expanded', String(open));
  };
  tlMoreBtn?.addEventListener('click', () => setMoreOpen(tlMoreMenu.hidden));
  document.addEventListener('click', (e) => {
    if (!tlMoreMenu || tlMoreMenu.hidden) return;
    if (e.target instanceof Element && e.target.closest('.tl-more')) return;
    setMoreOpen(false);
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && tlMoreMenu && !tlMoreMenu.hidden) setMoreOpen(false);
  });

  document.addEventListener('keydown', (e) => {
    if (views.edit?.hidden) return;
    const tag = (e.target && e.target.tagName) || '';
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
    if ((e.metaKey || e.ctrlKey) && (e.key === 'z' || e.key === 'Z')) {
      e.preventDefault();
      if (e.shiftKey) doRedo();
      else doUndo();
      return;
    }
    if ((e.metaKey || e.ctrlKey) && (e.key === 'y' || e.key === 'Y')) {
      e.preventDefault();
      doRedo();
      return;
    }
    if ((e.metaKey || e.ctrlKey) && ['c', 'x', 'v'].includes(e.key.toLowerCase()) && !e.shiftKey && !e.altKey) {
      // Selected text keeps native Cmd/Ctrl+C — clip copy only when nothing is highlighted.
      if (e.key.toLowerCase() === 'c' && String(window.getSelection?.() || '')) return;
      e.preventDefault();
      if (e.key.toLowerCase() === 'c') doCopyClip();
      else if (e.key.toLowerCase() === 'x') doCutClipToClipboard();
      else doPasteClip();
      return;
    }
    if (e.metaKey || e.ctrlKey) return;
    if (e.key === 'Escape' && cropMode) {
      e.preventDefault();
      cancelCrop();
      return;
    }
    if (e.key === ' ' || e.code === 'Space') {
      e.preventDefault();
      togglePlay();
    } else if (e.key === 's' || e.key === 'S' || e.key === 'b' || e.key === 'B') {
      e.preventDefault();
      doSplit();
    } else if (e.key === 'f' || e.key === 'F') {
      e.preventDefault();
      doFreeze();
    } else if (e.key === 'i' || e.key === 'I') {
      e.preventDefault();
      doMarkIn();
    } else if (e.key === 'o' || e.key === 'O') {
      e.preventDefault();
      doMarkOut();
    } else if (e.key === 'Delete' || e.key === 'Backspace') {
      e.preventDefault();
      doCut();
    } else if (e.key === 'ArrowLeft') {
      e.preventDefault();
      seekOutput(outputTime - (e.shiftKey ? 1 : 0.1));
    } else if (e.key === 'ArrowRight') {
      e.preventDefault();
      seekOutput(outputTime + (e.shiftKey ? 1 : 0.1));
    }
  });

  showView('record');
  studio.ffmpegOk().then((ok) => {
    if (!ok) setStatus('ffmpeg missing — Apply will fail until installed', 'warn');
  });
}());
