  const camEl = document.getElementById('camPreview');
  const screenEl = document.getElementById('screenPreview');
  const camStage = document.getElementById('camStage');
  const videoSel = document.getElementById('videoIn');
  const audioSel = document.getElementById('audioIn');
  const camStatus = document.getElementById('camStatus');
  const screenStatus = document.getElementById('screenStatus');
  const camRes = document.getElementById('camRes');
  const screenRes = document.getElementById('screenRes');
  const screenPicked = document.getElementById('screenPicked');
  const levelEl = document.getElementById('level');
  const logEl = document.getElementById('log');
  const secureWarn = document.getElementById('secureWarn');
  const takesEl = document.getElementById('takes');
  const recAllBtn = document.getElementById('recAllBtn');
  const recStopBtn = document.getElementById('recStopBtn');
  const incScreen = document.getElementById('incScreen');
  const incCam = document.getElementById('incCam');
  const incAudio = document.getElementById('incAudio');

  let camStream = null;
  let screenStream = null;
  let audioStream = null;
  let audioCtx = null;
  let meterRaf = 0;
  /** @type {'landscape'|'portrait'} */
  let orient = 'landscape';
  /** @type {'contain'|'cover'} */
  let fit = 'contain';
  let takeN = 0;
  let recStamp = '';
  let takeDir = '';
  let recTimer = 0;
  let recStartedAt = 0;
  /** @type {Record<string, {recorder: MediaRecorder, chunks: Blob[], mime: string}>} */
  let tracks = {};
  let stopping = false;
  const desktop = window.batchRecorder?.isDesktop === true;

  function log(msg) {
    const line = `[${new Date().toLocaleTimeString()}] ${msg}`;
    logEl.textContent = `${line}\n${logEl.textContent}`.trim();
    console.log(line);
  }

  if (!window.isSecureContext) {
    secureWarn.style.display = 'block';
    log('Not a secure context — serve over localhost.');
  }

  function pickVideoMime() {
    return [
      'video/webm;codecs=vp9,opus',
      'video/webm;codecs=vp8,opus',
      'video/webm',
      'video/mp4',
    ].find((t) => MediaRecorder.isTypeSupported?.(t)) || '';
  }

  function pickAudioMime() {
    return [
      'audio/webm;codecs=opus',
      'audio/webm',
      'audio/mp4',
    ].find((t) => MediaRecorder.isTypeSupported?.(t)) || '';
  }

  function fmtDur(ms) {
    const s = Math.floor(ms / 1000);
    return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
  }

  function setPill(el, text, cls) {
    el.textContent = text;
    el.className = 'pill' + (cls ? ` ${cls}` : '');
  }

  function videoConstraints(deviceId) {
    return orient === 'portrait'
      ? { deviceId: { exact: deviceId }, width: { ideal: 1080 }, height: { ideal: 1920 }, frameRate: { ideal: 30 } }
      : { deviceId: { exact: deviceId }, width: { ideal: 1920 }, height: { ideal: 1080 }, frameRate: { ideal: 30 } };
  }

  function applyOrientUI() {
    const portrait = orient === 'portrait';
    camStage.classList.toggle('portrait', portrait);
    document.getElementById('orientLandscape').classList.toggle('active', !portrait);
    document.getElementById('orientPortrait').classList.toggle('active', portrait);
  }

  function applyFitUI() {
    camStage.classList.toggle('fit-cover', fit === 'cover');
    document.getElementById('fitContain').classList.toggle('active', fit === 'contain');
    document.getElementById('fitCover').classList.toggle('active', fit === 'cover');
  }

  function stopMeter() {
    cancelAnimationFrame(meterRaf);
    if (audioCtx) { audioCtx.close().catch(() => {}); audioCtx = null; }
    levelEl.style.width = '0%';
  }

  function startMeter(track) {
    stopMeter();
    if (!track) return;
    audioCtx = new AudioContext();
    const src = audioCtx.createMediaStreamSource(new MediaStream([track]));
    const analyser = audioCtx.createAnalyser();
    analyser.fftSize = 256;
    src.connect(analyser);
    const data = new Uint8Array(analyser.frequencyBinCount);
    const tick = () => {
      analyser.getByteFrequencyData(data);
      let sum = 0;
      for (let i = 0; i < data.length; i++) sum += data[i];
      levelEl.style.width = `${Math.min(100, Math.round((sum / data.length / 255) * 140))}%`;
      meterRaf = requestAnimationFrame(tick);
    };
    tick();
  }

  function updateRes(el, stream) {
    const s = stream?.getVideoTracks?.()[0]?.getSettings?.() || {};
    el.textContent = s.width && s.height ? `${s.width}×${s.height}` : '—';
  }

  async function listDevices() {
    try {
      const tmp = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
      tmp.getTracks().forEach((t) => t.stop());
    } catch (e) {
      log(`Permission probe: ${e.name || e}`);
    }
    const devices = await navigator.mediaDevices.enumerateDevices();
    const cams = devices.filter((d) => d.kind === 'videoinput');
    const mics = devices.filter((d) => d.kind === 'audioinput');
    const keepCam = videoSel.value;
    const keepMic = audioSel.value;
    videoSel.innerHTML = cams.map((d, i) =>
      `<option value="${d.deviceId}">${d.label || `Camera ${i + 1}`}</option>`
    ).join('') || '<option value="">No cameras</option>';
    audioSel.innerHTML = '<option value="">(none)</option>' + mics.map((d, i) =>
      `<option value="${d.deviceId}">${d.label || `Mic ${i + 1}`}</option>`
    ).join('');
    if ([...videoSel.options].some((o) => o.value === keepCam)) videoSel.value = keepCam;
    else {
      const prefer = [...videoSel.options].find((o) =>
        /continuity|iphone|ipad|camo|iriun|bro camera/i.test(o.textContent) && !/desk view/i.test(o.textContent)
      );
      if (prefer) videoSel.value = prefer.value;
    }
    if ([...audioSel.options].some((o) => o.value === keepMic)) audioSel.value = keepMic;
    else {
      const preferMic = [...audioSel.options].find((o) =>
        /dji|bro microphone|continuity/i.test(o.textContent)
      );
      if (preferMic) audioSel.value = preferMic.value;
    }
    log(`Devices: ${cams.length} cam · ${mics.length} mic`);
  }

  async function startCamPreview() {
    if (Object.keys(tracks).length) throw new Error('Stop recording first');
    stopCamPreview();
    const videoId = videoSel.value;
    if (!videoId) throw new Error('Pick a camera');
    const audioId = audioSel.value;
    camStream = await navigator.mediaDevices.getUserMedia({
      video: videoConstraints(videoId),
      audio: false,
    });
    camEl.srcObject = camStream;
    setPill(camStatus, 'live', 'live');
    updateRes(camRes, camStream);
    log(`Cam: ${camStream.getVideoTracks()[0]?.label || 'camera'}`);

    if (audioId) {
      audioStream = await navigator.mediaDevices.getUserMedia({
        audio: { deviceId: { exact: audioId } },
        video: false,
      });
      startMeter(audioStream.getAudioTracks()[0]);
      log(`Mic: ${audioStream.getAudioTracks()[0]?.label || 'mic'}`);
    }
  }

  function stopCamPreview() {
    if (camStream) { camStream.getTracks().forEach((t) => t.stop()); camStream = null; }
    if (audioStream && !tracks.audio) {
      audioStream.getTracks().forEach((t) => t.stop());
      audioStream = null;
    }
    camEl.srcObject = null;
    stopMeter();
    setPill(camStatus, 'off', 'off');
    camRes.textContent = '—';
  }

  async function pickScreen() {
    if (Object.keys(tracks).length) throw new Error('Stop recording first');
    if (!navigator.mediaDevices?.getDisplayMedia) {
      throw new Error(
        'Screen capture not available in this browser surface. Open this page in Chrome/Safari, or use ./dual-record.sh for screen.'
      );
    }
    clearScreen(false);

    // Minimal constraints first — Cursor Glass / some Chromium embeds throw
    // "Not supported" if we pass displaySurface / preferCurrentTab / etc.
    const attempts = [
      { video: true, audio: false },
      { video: { frameRate: 30 }, audio: false },
      {
        video: {
          frameRate: { ideal: 30 },
          width: { ideal: 1920 },
          height: { ideal: 1080 },
        },
        audio: false,
      },
    ];

    let lastErr = null;
    for (const constraints of attempts) {
      try {
        screenStream = await navigator.mediaDevices.getDisplayMedia(constraints);
        lastErr = null;
        break;
      } catch (e) {
        lastErr = e;
        const msg = e?.message || e?.name || String(e);
        log(`getDisplayMedia attempt failed: ${msg}`);
        // User cancelled — don't retry
        if (e?.name === 'NotAllowedError' || /denied|cancel/i.test(msg)) throw e;
      }
    }
    if (!screenStream) {
      throw lastErr || new Error(
        'Screen picker failed. Use the Stem Studio desktop app, or try a browser with screen capture support.'
      );
    }

    const track = screenStream.getVideoTracks()[0];
    const settings = track.getSettings?.() || {};
    const surface = settings.displaySurface || 'unknown';
    screenEl.srcObject = screenStream;
    setPill(screenStatus, surface, 'live');
    updateRes(screenRes, screenStream);
    screenPicked.textContent = `Picked: ${track.label || surface} (${surface})`;
    screenPicked.classList.add('on');
    log(`Screen: ${track.label || surface} · ${surface}`);
    track.addEventListener('ended', () => {
      log('Screen share ended by user');
      if (Object.keys(tracks).length) stopRecording();
      else clearScreen(true);
    });
  }

  function clearScreen(silent) {
    if (screenStream) {
      screenStream.getTracks().forEach((t) => t.stop());
      screenStream = null;
    }
    screenEl.srcObject = null;
    setPill(screenStatus, 'off', 'off');
    screenRes.textContent = '—';
    screenPicked.textContent = 'Nothing picked yet';
    screenPicked.classList.remove('on');
    if (!silent) log('Screen cleared');
  }

  function trackExt(blob, kind) {
    if (kind === 'audio') {
      if ((blob.type || '').includes('mp4')) return 'm4a';
      return 'webm';
    }
    if ((blob.type || '').includes('mp4')) return 'mp4';
    return 'webm';
  }

  async function saveTrack(blob, kind) {
    const ext = trackExt(blob, kind);
    if (desktop && takeDir) {
      const buf = await blob.arrayBuffer();
      const file = await window.batchRecorder.saveTrack({
        takeDir,
        kind,
        ext,
        data: buf,
      });
      const base = file.split(/[/\\]/).pop();
      const a = document.createElement('a');
      a.href = '#';
      a.textContent = `✓ ${base} · ${(blob.size / 1e6).toFixed(2)} MB raw → folder`;
      a.onclick = (e) => { e.preventDefault(); window.batchRecorder.openTake(takeDir); };
      takesEl.prepend(a);
      log(`Saved ${file}`);
      return;
    }
    // Browser fallback — browsers often allow only ONE auto-download
    const name = `${kind}.${ext}`;
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `take-${recStamp}-${name}`;
    a.textContent = `↓ take-${recStamp}-${name} · ${(blob.size / 1e6).toFixed(2)} MB`;
    takesEl.prepend(a);
    a.click();
    log(`Browser download ${name} (use desktop app for a take folder)`);
  }

  function makeRecorder(stream, kind, mime) {
    // Clone so preview + recorder do not fight over the same track
    const recStream = new MediaStream(stream.getTracks().map((t) => t.clone()));
    const chunks = [];
    const opts = { mimeType: mime || undefined };
    if (kind === 'audio') opts.audioBitsPerSecond = 192_000;
    else opts.videoBitsPerSecond = 8_000_000;
    let recorder;
    try {
      recorder = mime ? new MediaRecorder(recStream, opts) : new MediaRecorder(recStream);
    } catch (e) {
      recorder = new MediaRecorder(recStream);
    }
    recorder.ondataavailable = (e) => { if (e.data?.size) chunks.push(e.data); };
    recorder.onerror = (e) => log(`${kind} recorder error: ${e.error?.name || e}`);
    tracks[kind] = { recorder, chunks, mime: mime || recorder.mimeType || '', recStream };
    recorder.start(1000);
    log(`Recording ${kind} (${recorder.mimeType || 'default'})`);
  }

  async function ensureCam() {
    if (!camStream) await startCamPreview();
    if (!camStream?.getVideoTracks().length) throw new Error('Camera not available');
    return camStream;
  }

  async function ensureAudio() {
    const audioId = audioSel.value;
    if (!audioId) throw new Error('Pick a microphone for audio track');
    if (!audioStream || audioStream.getAudioTracks().length === 0) {
      audioStream = await navigator.mediaDevices.getUserMedia({
        audio: { deviceId: { exact: audioId } },
        video: false,
      });
      startMeter(audioStream.getAudioTracks()[0]);
    }
    if (!audioStream.getAudioTracks().length) throw new Error('Mic track missing');
    return audioStream;
  }

  async function ensureScreen() {
    if (!screenStream) await pickScreen();
    if (!screenStream?.getVideoTracks().length) throw new Error('Screen not picked');
    return screenStream;
  }

  async function startRecordingAll() {
    if (Object.keys(tracks).length) throw new Error('Already recording');
    const wantScreen = incScreen.checked;
    const wantCam = incCam.checked;
    const wantAudio = incAudio.checked;
    if (!wantScreen && !wantCam && !wantAudio) throw new Error('Enable at least one track');

    // Screen picker first (requires user gesture chain)
    if (wantScreen && !screenStream) await ensureScreen();
    if (wantCam) await ensureCam();
    if (wantAudio) await ensureAudio();

    takeN += 1;
    recStamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    tracks = {};
    stopping = false;
    takeDir = '';
    if (desktop) {
      takeDir = await window.batchRecorder.beginTake(recStamp);
      log(`Take folder: ${takeDir}`);
    }

    const videoMime = pickVideoMime();
    const audioMime = pickAudioMime();

    // Start all requested tracks; fail loudly per track
    const started = [];
    if (wantScreen) {
      makeRecorder(await ensureScreen(), 'screen', videoMime);
      started.push('screen');
    }
    if (wantCam) {
      makeRecorder(await ensureCam(), 'cam', videoMime);
      started.push('cam');
    }
    if (wantAudio) {
      makeRecorder(await ensureAudio(), 'audio', audioMime);
      started.push('audio');
    }
    if (!started.length) throw new Error('No tracks started');

    recAllBtn.disabled = true;
    recAllBtn.classList.add('active');
    recAllBtn.textContent = 'Recording';
    recStopBtn.disabled = false;
    recStartedAt = Date.now();
    clearInterval(recTimer);
    recTimer = setInterval(() => {
      recAllBtn.textContent = `Recording ${fmtDur(Date.now() - recStartedAt)}`;
    }, 250);
    log(`Take ${recStamp} started · ${[
      wantScreen && 'screen',
      wantCam && 'cam',
      wantAudio && 'audio',
    ].filter(Boolean).join(' + ')}`);
  }

  function stopRecording() {
    if (stopping) return;
    stopping = true;
    clearInterval(recTimer);
    const kinds = Object.keys(tracks);
    if (!kinds.length) {
      finishingUI();
      return;
    }
    let left = kinds.length;
    kinds.forEach((kind) => {
      const entry = tracks[kind];
      entry.recorder.onstop = async () => {
        try {
          entry.recStream?.getTracks?.().forEach((t) => t.stop());
          const type = entry.recorder.mimeType || entry.mime
            || (kind === 'audio' ? 'audio/webm' : 'video/webm');
          await saveTrack(new Blob(entry.chunks, { type }), kind);
        } catch (e) {
          log(`Save ${kind} failed: ${e.message || e}`);
        }
        left -= 1;
        if (left <= 0) {
          tracks = {};
          finishingUI();
          log(`Take complete${takeDir ? `: ${takeDir}` : ''}`);
          if (desktop && takeDir) window.batchRecorder.openTake(takeDir);
        }
      };
      if (entry.recorder.state !== 'inactive') entry.recorder.stop();
      else entry.recorder.onstop();
    });
  }

  function finishingUI() {
    stopping = false;
    recAllBtn.disabled = false;
    recAllBtn.classList.remove('active');
    recAllBtn.textContent = 'Record';
    recStopBtn.disabled = true;
  }

  async function previewAll() {
    if (incCam.checked) {
      try { await startCamPreview(); } catch (e) { log(`Cam preview: ${e.message || e}`); }
    }
    if (incScreen.checked && !screenStream) {
      try { await pickScreen(); } catch (e) { log(`Screen preview: ${e.message || e.name || e}`); }
    } else if (screenStream) {
      setPill(screenStatus, screenStream.getVideoTracks()[0]?.getSettings?.()?.displaySurface || 'live', 'live');
      updateRes(screenRes, screenStream);
    }
  }

  function debouncePreview(fn, ms = 200) {
    let t = 0;
    return (...args) => {
      clearTimeout(t);
      t = setTimeout(() => fn(...args), ms);
    };
  }

  const onSourceChange = debouncePreview(() => {
    if (Object.keys(tracks).length) return;
    previewAll();
  });

  document.getElementById('previewBtn').onclick = () => previewAll();
  document.getElementById('stopPreviewBtn').onclick = () => {
    stopCamPreview();
    clearScreen(true);
    log('Previews stopped');
  };
  document.getElementById('refreshBtn').onclick = () => listDevices()
    .then(() => onSourceChange())
    .catch((e) => log(String(e)));
  document.getElementById('mirrorBtn').onclick = () => camEl.classList.toggle('mirror');
  document.getElementById('pickScreenBtn').onclick = () => pickScreen().catch((e) => log(String(e.message || e.name || e)));
  document.getElementById('clearScreenBtn').onclick = () => clearScreen(false);
  document.getElementById('openChromeBtn').onclick = () => {
    const url = location.href;
    log(`Open this URL in Chrome: ${url}`);
    window.open(url, '_blank', 'noopener');
  };
  videoSel.onchange = onSourceChange;
  audioSel.onchange = onSourceChange;
  incScreen.onchange = () => {
    if (!incScreen.checked) clearScreen(true);
    else onSourceChange();
  };
  incCam.onchange = () => {
    if (!incCam.checked) stopCamPreview();
    else onSourceChange();
  };
  document.getElementById('orientLandscape').onclick = async () => {
    orient = 'landscape'; applyOrientUI();
    onSourceChange();
  };
  document.getElementById('orientPortrait').onclick = async () => {
    orient = 'portrait'; applyOrientUI();
    onSourceChange();
  };
  document.getElementById('fitContain').onclick = () => { fit = 'contain'; applyFitUI(); };
  document.getElementById('fitCover').onclick = () => { fit = 'cover'; applyFitUI(); };
  recAllBtn.onclick = () => startRecordingAll().catch((e) => log(String(e.message || e)));
  recStopBtn.onclick = () => stopRecording();

  applyOrientUI();
  applyFitUI();
  listDevices()
    .then(() => onSourceChange())
    .catch((e) => log(String(e.message || e)));
