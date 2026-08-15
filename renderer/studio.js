'use strict';

/**
 * Edit-T1 CapCut/TikTok-style timeline:
 * preview on top · horizontal V1 track · playhead · Split / Delete.
 */
(function studioUi() {
  const studio = window.stemStudio;
  const ops = window.StemClipOps;
  if (!studio || !ops) return;

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
  const cutBtn = document.getElementById('cutBtn');
  const tlTrack = document.getElementById('tlTrack');
  const tlClips = document.getElementById('tlClips');
  const tlPlayhead = document.getElementById('tlPlayhead');
  const tlRuler = document.getElementById('tlRuler');
  const tlOutTime = document.getElementById('tlOutTime');
  const tlPlayBtn = document.getElementById('tlPlayBtn');

  let currentTakeId = null;
  let manifest = null;
  let duration = null; // source media duration
  let selectedIdx = 0;
  let outputTime = 0;
  let playing = false;
  let draggingPlayhead = false;
  let syncingFromTimeline = false;

  function setStatus(msg, kind) {
    editStatus.textContent = msg || '';
    editStatus.dataset.kind = kind || '';
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
    const r = String(s % 60).padStart(2, '0');
    return `${m}:${r}`;
  }

  function outDur() {
    return ops.totalOutputDuration(manifest?.clips || [], duration);
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

  function seekOutput(t, { seekVideo = true } = {}) {
    const total = outDur();
    outputTime = Math.max(0, Math.min(Number(t) || 0, Math.max(0, total - 0.001)));
    updatePlayheadUi();
    if (!seekVideo || !manifest?.clips?.length) return;
    const mapped = ops.outputToSource(manifest.clips, outputTime, duration);
    selectedIdx = mapped.index;
    syncingFromTimeline = true;
    editVideo.currentTime = mapped.sourceTime;
    renderClipsList();
    renderTimeline();
    syncFieldsFromClip();
    editTimeLabel.textContent = `out ${fmt(outputTime)} · src ${fmt(mapped.sourceTime)}`;
    if (tlOutTime) tlOutTime.textContent = `${fmtClock(outputTime)} / ${fmtClock(total)}`;
    requestAnimationFrame(() => { syncingFromTimeline = false; });
  }

  function updatePlayheadUi() {
    const total = outDur() || 1;
    const pct = (outputTime / total) * 100;
    if (tlPlayhead) tlPlayhead.style.left = `${pct}%`;
  }

  function renderRuler() {
    if (!tlRuler) return;
    tlRuler.innerHTML = '';
    const total = outDur();
    if (total <= 0) return;
    const step = total > 30 ? 5 : total > 12 ? 2 : 1;
    for (let t = 0; t <= total + 0.01; t += step) {
      const span = document.createElement('span');
      span.textContent = fmtClock(t);
      span.style.left = `${(t / total) * 100}%`;
      tlRuler.appendChild(span);
    }
  }

  function renderTimeline() {
    if (!tlClips || !manifest) return;
    tlClips.innerHTML = '';
    const total = outDur() || 1;
    manifest.clips.forEach((clip, idx) => {
      const dur = ops.clipDuration(clip, duration);
      const el = document.createElement('div');
      el.className = 'tl-clip' + (idx === selectedIdx ? ' selected' : '');
      el.style.flex = `0 0 ${(dur / total) * 100}%`;
      el.textContent = `#${idx + 1}`;
      el.title = `${fmt(clip.in)} → ${fmt(clip.out)} (${fmt(dur)})`;
      el.addEventListener('click', (e) => {
        e.stopPropagation();
        selectClip(idx);
        // Jump playhead to start of this clip on output timeline
        let acc = 0;
        for (let i = 0; i < idx; i += 1) acc += ops.clipDuration(manifest.clips[i], duration);
        seekOutput(acc + 0.01);
      });
      tlClips.appendChild(el);
    });
    renderRuler();
    updatePlayheadUi();
  }

  function renderClipsList() {
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
    renderClipsList();
    renderTimeline();
    syncFieldsFromClip();
    const c = selectedClip();
    setStatus(`Selected #${selectedIdx + 1} · ${fmt(c.in)} → ${fmt(c.out)}`);
  }

  function refreshAll() {
    renderClipsList();
    renderTimeline();
    syncFieldsFromClip();
    const total = outDur();
    if (tlOutTime) tlOutTime.textContent = `${fmtClock(outputTime)} / ${fmtClock(total)}`;
  }

  async function openEdit(takeId) {
    setStatus('Loading…');
    stopPlay();
    const data = await studio.getTake(takeId);
    currentTakeId = takeId;
    manifest = data.manifest;
    duration = data.duration;
    selectedIdx = 0;
    outputTime = 0;
    editTitle.textContent = takeId;
    const navEdit = document.getElementById('navEdit');
    if (navEdit) navEdit.hidden = false;
    const url = data.urls['screen.mp4'];
    if (!url) {
      setStatus('No screen.mp4 in this take', 'warn');
      return;
    }
    editVideo.src = url;
    showView('edit');
    refreshAll();
    seekOutput(0);
    setStatus(data.urls['edit/final.mp4'] ? 'Loaded · final exists' : 'Select a clip · Split / Delete · Apply');
  }

  function doSplit() {
    try {
      const mapped = ops.outputToSource(manifest.clips, outputTime, duration);
      manifest.clips = ops.splitAt(manifest.clips, mapped.index, mapped.sourceTime, duration);
      selectedIdx = mapped.index;
      refreshAll();
      seekOutput(outputTime);
      setStatus(`Split at ${fmt(mapped.sourceTime)} → ${manifest.clips.length} clips`, 'ok');
    } catch (e) {
      setStatus(String(e.message || e), 'warn');
    }
  }

  function doCut() {
    try {
      manifest.clips = ops.cutClip(manifest.clips, selectedIdx);
      if (selectedIdx >= manifest.clips.length) selectedIdx = manifest.clips.length - 1;
      refreshAll();
      seekOutput(Math.min(outputTime, Math.max(0, outDur() - 0.01)));
      setStatus('Deleted selected clip', 'ok');
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
    const mapped = ops.outputToSource(manifest.clips, outputTime, duration);
    editVideo.currentTime = mapped.sourceTime;
    editVideo.play().catch(() => stopPlay());
  }

  // Keep output playhead in sync while source video plays across a clip
  editVideo?.addEventListener('timeupdate', () => {
    if (syncingFromTimeline || draggingPlayhead || !manifest?.clips?.length) return;
    const src = editVideo.currentTime;
    const c = selectedClip();
    if (!c) return;
    const end = ops.clipEnd(c, duration);
    if (playing && end != null && src >= end - 0.04) {
      // advance to next clip
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
    if (Number.isFinite(editVideo.duration) && editVideo.duration > 0) {
      duration = editVideo.duration;
    }
    refreshAll();
    seekOutput(outputTime);
  });

  editVideo?.addEventListener('ended', stopPlay);

  function pointerToOutput(clientX) {
    const rect = tlTrack.getBoundingClientRect();
    const x = Math.max(0, Math.min(clientX - rect.left, rect.width));
    const total = outDur() || 1;
    return (x / rect.width) * total;
  }

  tlTrack?.addEventListener('pointerdown', (e) => {
    if (e.target.closest('.tl-clip')) return; // clip handler selects
    draggingPlayhead = true;
    tlTrack.setPointerCapture(e.pointerId);
    seekOutput(pointerToOutput(e.clientX));
  });
  tlTrack?.addEventListener('pointermove', (e) => {
    if (!draggingPlayhead) return;
    seekOutput(pointerToOutput(e.clientX));
  });
  tlTrack?.addEventListener('pointerup', () => { draggingPlayhead = false; });
  tlTrack?.addEventListener('pointercancel', () => { draggingPlayhead = false; });

  tlPlayBtn?.addEventListener('click', togglePlay);
  splitBtn?.addEventListener('click', doSplit);
  cutBtn?.addEventListener('click', doCut);

  setClipRangeBtn?.addEventListener('click', () => {
    const inn = Number(clipInSec.value);
    const out = Number(clipOutSec.value);
    if (!Number.isFinite(inn) || !Number.isFinite(out) || out <= inn) {
      setStatus('In/Out invalid', 'warn');
      return;
    }
    const active = selectedClip();
    if (!active) return;
    active.in = inn;
    active.out = out;
    refreshAll();
    seekOutput(ops.sourceToOutput(manifest.clips, selectedIdx, inn, duration));
    setStatus(`Trimmed #${selectedIdx + 1} → ${fmt(inn)}–${fmt(out)}`, 'ok');
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
    if (tag === 'INPUT' || tag === 'TEXTAREA') return;
    if (e.key === ' ' || e.code === 'Space') {
      e.preventDefault();
      togglePlay();
    } else if (e.key === 's' || e.key === 'S' || e.key === 'b' || e.key === 'B') {
      e.preventDefault();
      doSplit();
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
