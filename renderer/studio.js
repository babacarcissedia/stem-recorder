'use strict';

/**
 * CapCut-like Edit-T1: multi-stem tracks (cam/screen/audio), full-height playhead,
 * split / delete (ripple), edge resize, preview rate. Linked stems share clips[].
 */
(function studioUi() {
  const studio = window.stemStudio;
  const ops = window.StemClipOps;
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
  /** Selection index the timeline DOM was last built for — scrub repaints skip rebuilds. */
  let renderedSelectedIdx = -1;
  /** In-session undo/redo over clip-list snapshots (not persisted to disk). */
  const undoStack = window.StemUndoStack ? window.StemUndoStack.createUndoStack(100) : null;

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
      const srcT = start + ((i + 0.5) / count) * dur;
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
      const srcT = start + ((i + 0.5) / bars) * dur;
      const idx = Math.max(0, Math.min(waveform.peaks.length - 1, Math.floor(srcT * waveform.peaksPerSec)));
      const b = document.createElement('b');
      b.style.height = `${Math.round(8 + waveform.peaks[idx] * 92)}%`;
      wrap.appendChild(b);
    }
    return wrap;
  }

  function loadTimelineMedia(takeId) {
    filmstrips = { cam: null, screen: null };
    waveform = null;
    const applyIfCurrent = (assign) => (data) => {
      if (currentTakeId !== takeId || !data) return;
      assign(data);
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
        el.className = `tl-clip ${lane.id}${idx === selectedIdx ? ' selected' : ''}${has ? '' : ' missing'}`;
        el.style.flex = `0 0 ${clipW}px`;
        el.title = `${lane.label} · ${fmt(clip.in)} → ${fmt(clip.out)}`;
        if (lane.kind === 'audio') el.appendChild(waveBarsEl(clip, clipW));
        else el.appendChild(filmStripEl(lane.id, clip, clipW));
        const label = document.createElement('span');
        label.className = 'label';
        label.textContent = `#${idx + 1}`;
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
      row.innerHTML = `<div class="clip-meta"><strong>#${idx + 1}${idx === selectedIdx ? ' · selected' : ''}</strong>
        <span>${fmt(clip.in)} → ${fmt(clip.out)}</span></div>`;
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
    setStatus(`Selected #${selectedIdx + 1} · ${fmt(c.in)} → ${fmt(c.out)}`);
  }

  function refreshAll() {
    renderSelectionPanel();
    renderTimeline();
    syncFieldsFromClip();
    applyPlaybackRate();
    const total = outDur();
    if (tlOutTime) tlOutTime.textContent = `${fmtClock(outputTime)} / ${fmtClock(total)}`;
  }

  function loadPreviewStem() {
    const file = previewStem === 'cam' ? 'cam.mp4' : 'screen.mp4';
    const url = urls[file] || urls['screen.mp4'];
    if (!url) return;
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
    undoStack?.clear();
    updateUndoUi();
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
    if (!transcriptPanel) return;
    transcriptPanel.innerHTML = '';
    if (!data || !data.cues?.length) {
      transcriptPanel.innerHTML = '<p class="empty">No transcript yet.</p>';
      return;
    }
    data.cues.forEach((cue) => {
      const row = document.createElement('button');
      row.type = 'button';
      row.className = 'cue-row';
      const time = document.createElement('span');
      time.className = 'cue-time';
      time.textContent = fmt(cue.start);
      const text = document.createElement('span');
      text.className = 'cue-text';
      text.textContent = cue.text;
      row.appendChild(time);
      row.appendChild(text);
      row.addEventListener('click', () => seekToCue(cue));
      transcriptPanel.appendChild(row);
    });
  }

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

  function snapshot() {
    return { clips: manifest.clips.map((c) => ({ ...c })), selectedIdx };
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
    setStatus(`Mark In ${fmt(markIn)} · ${marksHint()} · set Mark Out then Cut range`, 'ok');
  }

  function doMarkOut() {
    if (!manifest?.clips?.length) return;
    const mapped = ops.outputToSource(manifest.clips, outputTime, duration);
    markOut = mapped.sourceTime;
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

  function stopPlay() {
    playing = false;
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
    if (syncingFromTimeline || draggingPlayhead || resizing || !manifest?.clips?.length) return;
    const src = editVideo.currentTime;
    const c = selectedClip();
    if (!c) return;
    const end = ops.clipEnd(c, duration);
    if (playing && end != null && src >= end - 0.04) {
      if (selectedIdx < manifest.clips.length - 1) {
        selectedIdx += 1;
        const next = manifest.clips[selectedIdx];
        syncingFromTimeline = true;
        editVideo.currentTime = next.in || 0;
        refreshAll();
        requestAnimationFrame(() => { syncingFromTimeline = false; });
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

  tlPlayBtn?.addEventListener('click', togglePlay);
  undoBtn?.addEventListener('click', doUndo);
  redoBtn?.addEventListener('click', doRedo);
  splitBtn?.addEventListener('click', doSplit);
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
      setStatus(`Applied → edit/final.mp4 (${res.clips} clip${res.clips === 1 ? '' : 's'})`, 'ok');
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
    if (e.metaKey || e.ctrlKey) return;
    if (e.key === ' ' || e.code === 'Space') {
      e.preventDefault();
      togglePlay();
    } else if (e.key === 's' || e.key === 'S' || e.key === 'b' || e.key === 'B') {
      e.preventDefault();
      doSplit();
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
