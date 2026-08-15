'use strict';

/**
 * Edit-T1 UI: library + timeline clips + local apply.
 * Requires window.stemStudio (Electron preload).
 */
(function studioUi() {
  const studio = window.stemStudio;
  if (!studio) return;

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
  const timeLabel = document.getElementById('editTimeLabel');
  const markInBtn = document.getElementById('markInBtn');
  const markOutBtn = document.getElementById('markOutBtn');
  const addClipBtn = document.getElementById('addClipBtn');
  const saveManifestBtn = document.getElementById('saveManifestBtn');
  const applyBtn = document.getElementById('applyBtn');
  const openFolderBtn = document.getElementById('openFolderBtn');
  const backLibraryBtn = document.getElementById('backLibraryBtn');
  const editScrub = document.getElementById('editScrub');
  const clipInSec = document.getElementById('clipInSec');
  const clipOutSec = document.getElementById('clipOutSec');
  const setClipRangeBtn = document.getElementById('setClipRangeBtn');

  let currentTakeId = null;
  let manifest = null;
  let duration = null;
  let draftIn = null;
  let scrubbing = false;

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

  function syncScrubFromVideo() {
    if (!editScrub || scrubbing) return;
    const total = duration || editVideo.duration || 0;
    if (!total) return;
    editScrub.value = String(Math.round((editVideo.currentTime / total) * 1000));
  }

  function syncFieldsFromClip() {
    if (!manifest?.clips?.length || !clipInSec || !clipOutSec) return;
    const c = manifest.clips[manifest.clips.length - 1];
    clipInSec.value = String(c.in ?? 0);
    clipOutSec.value = String(c.out ?? (duration ?? 0));
  }

  function renderClips() {
    clipList.innerHTML = '';
    if (!manifest) return;
    manifest.clips.forEach((clip, idx) => {
      const row = document.createElement('div');
      row.className = 'clip-row';
      row.innerHTML = `
        <div class="clip-meta">
          <strong>#${idx + 1}</strong>
          <span>${fmt(clip.in)} → ${clip.out == null ? 'end' : fmt(clip.out)}</span>
        </div>
        <div class="clip-actions">
          <button type="button" data-act="up" ${idx === 0 ? 'disabled' : ''}>↑</button>
          <button type="button" data-act="down" ${idx >= manifest.clips.length - 1 ? 'disabled' : ''}>↓</button>
          <button type="button" data-act="seek">Seek</button>
          <button type="button" data-act="del" class="danger-text">Del</button>
        </div>`;
      row.querySelector('[data-act="up"]').onclick = () => moveClip(idx, -1);
      row.querySelector('[data-act="down"]').onclick = () => moveClip(idx, 1);
      row.querySelector('[data-act="seek"]').onclick = () => {
        editVideo.currentTime = clip.in || 0;
      };
      row.querySelector('[data-act="del"]').onclick = () => {
        if (manifest.clips.length <= 1) {
          setStatus('Keep at least one clip', 'warn');
          return;
        }
        manifest.clips.splice(idx, 1);
        renderClips();
      };
      clipList.appendChild(row);
    });
    syncFieldsFromClip();
  }

  function moveClip(idx, delta) {
    const j = idx + delta;
    if (j < 0 || j >= manifest.clips.length) return;
    const tmp = manifest.clips[idx];
    manifest.clips[idx] = manifest.clips[j];
    manifest.clips[j] = tmp;
    renderClips();
  }

  function refreshTimeLabel() {
    const total = duration ?? (Number.isFinite(editVideo.duration) ? editVideo.duration : null);
    timeLabel.textContent = `${fmt(editVideo.currentTime)} / ${fmt(total)}`;
    syncScrubFromVideo();
  }

  async function openEdit(takeId) {
    setStatus('Loading…');
    const data = await studio.getTake(takeId);
    currentTakeId = takeId;
    manifest = data.manifest;
    duration = data.duration;
    editTitle.textContent = takeId;
    const navEdit = document.getElementById('navEdit');
    if (navEdit) navEdit.hidden = false;
    const url = data.urls['screen.mp4'];
    if (!url) {
      setStatus('No screen.mp4 in this take', 'warn');
      return;
    }
    editVideo.src = url;
    draftIn = null;
    renderClips();
    showView('edit');
    setStatus(data.urls['edit/final.mp4'] ? 'Loaded (final exists)' : 'Loaded — trim clips, Save, Apply');
  }

  editVideo?.addEventListener('loadedmetadata', () => {
    if (Number.isFinite(editVideo.duration) && editVideo.duration > 0) {
      duration = editVideo.duration;
    }
    refreshTimeLabel();
    syncFieldsFromClip();
  });

  editVideo?.addEventListener('timeupdate', refreshTimeLabel);

  editScrub?.addEventListener('input', () => {
    scrubbing = true;
    const total = duration || editVideo.duration || 0;
    if (!total) return;
    editVideo.currentTime = (Number(editScrub.value) / 1000) * total;
    refreshTimeLabel();
  });
  editScrub?.addEventListener('change', () => { scrubbing = false; });

  markInBtn?.addEventListener('click', () => {
    draftIn = Number(editVideo.currentTime) || 0;
    if (clipInSec) clipInSec.value = String(Math.round(draftIn * 100) / 100);
    setStatus(`In marked at ${fmt(draftIn)} — scrub forward, then Mark Out`);
  });

  markOutBtn?.addEventListener('click', () => {
    if (draftIn == null) {
      setStatus('Mark In first (or use Set clip from In/Out)', 'warn');
      return;
    }
    let out = Number(editVideo.currentTime) || 0;
    const inn = draftIn;
    if (out <= inn + 0.05) {
      setStatus(`Out (${fmt(out)}) must be after In (${fmt(inn)}) — scrub further`, 'warn');
      return;
    }
    const active = manifest.clips[manifest.clips.length - 1];
    active.in = Math.round(inn * 1000) / 1000;
    active.out = Math.round(out * 1000) / 1000;
    draftIn = null;
    renderClips();
    setStatus(`Clip set ${fmt(active.in)} → ${fmt(active.out)}`, 'ok');
  });

  setClipRangeBtn?.addEventListener('click', () => {
    const inn = Number(clipInSec.value);
    const out = Number(clipOutSec.value);
    if (!Number.isFinite(inn) || !Number.isFinite(out) || out <= inn) {
      setStatus('In/Out seconds invalid (Out must be > In)', 'warn');
      return;
    }
    const active = manifest.clips[manifest.clips.length - 1];
    active.in = inn;
    active.out = out;
    draftIn = null;
    renderClips();
    editVideo.currentTime = inn;
    setStatus(`Clip set ${fmt(inn)} → ${fmt(out)}`, 'ok');
  });

  addClipBtn?.addEventListener('click', () => {
    const last = manifest.clips[manifest.clips.length - 1];
    const start = last?.out != null ? last.out : (editVideo.currentTime || 0);
    manifest.clips.push({
      id: `clip-${Date.now()}`,
      source: 'screen.mp4',
      in: start,
      out: duration,
    });
    renderClips();
    setStatus('Clip added');
  });

  saveManifestBtn?.addEventListener('click', async () => {
    try {
      const res = await studio.saveManifest(currentTakeId, manifest);
      manifest = res.manifest;
      renderClips();
      setStatus('Saved edit/manifest.json', 'ok');
    } catch (e) {
      setStatus(String(e.message || e), 'warn');
    }
  });

  applyBtn?.addEventListener('click', async () => {
    try {
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

  backLibraryBtn?.addEventListener('click', () => showView('library'));

  // Default view
  showView('record');
  studio.ffmpegOk().then((ok) => {
    if (!ok) setStatus('ffmpeg missing — Apply will fail until installed', 'warn');
  });
}());
