(function () {
  'use strict';

  const state = {
    freq: 440,
    volume: 1.0,
    playing: false,
    muted: false,
    waveType: 'sine',
    channel: 'both',
    animFrame: null,
  };

  const WAVE_TYPES = ['sine', 'square', 'sawtooth', 'triangle'];
  const WAVE_LABELS = { sine: 'Sine', square: 'Square', sawtooth: 'Saw', triangle: 'Triangle' };

  const MIN_HZ = 1;
  const MAX_HZ = 22000;
  const SLIDER_MAX = 1000;
  const LOG_MIN = Math.log(MIN_HZ);
  const LOG_MAX = Math.log(MAX_HZ);

  function sliderToHz(sliderVal) {
    const t = sliderVal / SLIDER_MAX;
    return Math.round(Math.exp(LOG_MIN + t * (LOG_MAX - LOG_MIN)));
  }

  function hzToSlider(hz) {
    const t = (Math.log(hz) - LOG_MIN) / (LOG_MAX - LOG_MIN);
    return t * SLIDER_MAX;
  }

  let audioCtx = null;
  let oscillator = null;
  let gainNode = null;
  let pannerNode = null;

  function getAudioCtx() {
    if (!audioCtx) {
      audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    }
    return audioCtx;
  }

  function startTone() {
    const ctx = getAudioCtx();
    if (ctx.state === 'suspended') ctx.resume();

    oscillator = ctx.createOscillator();
    gainNode = ctx.createGain();
    pannerNode = ctx.createStereoPanner();

    oscillator.type = state.waveType;
    oscillator.frequency.setValueAtTime(state.freq, ctx.currentTime);
    gainNode.gain.setValueAtTime(state.muted ? 0 : state.volume, ctx.currentTime);
    pannerNode.pan.setValueAtTime(getPanValue(), ctx.currentTime);

    oscillator.connect(gainNode);
    gainNode.connect(pannerNode);
    pannerNode.connect(ctx.destination);

    oscillator.start();
    state.playing = true;
    updatePlayUI();
    startVisualizer();
  }

  function stopTone() {
    if (oscillator) {
      try { oscillator.stop(); } catch (_) { }
      oscillator.disconnect();
      oscillator = null;
    }
    if (gainNode) { gainNode.disconnect(); gainNode = null; }
    if (pannerNode) { pannerNode.disconnect(); pannerNode = null; }
    state.playing = false;
    updatePlayUI();
    stopVisualizer();
  }

  function getPanValue() {
    if (state.channel === 'left') return -1;
    if (state.channel === 'right') return 1;
    return 0;
  }

  function updateFreq(hz) {
    state.freq = hz;
    if (oscillator) {
      oscillator.frequency.setTargetAtTime(hz, audioCtx.currentTime, 0.015);
    }
  }

  function updateGain() {
    if (gainNode) {
      const target = state.muted ? 0 : state.volume;
      gainNode.gain.setTargetAtTime(target, audioCtx.currentTime, 0.015);
    }
  }
  function updatePan() {
    if (pannerNode) {
      pannerNode.pan.setTargetAtTime(getPanValue(), audioCtx.currentTime, 0.015);
    }
  }

  const canvas = document.getElementById('waveCanvas');
  const ctx2d = canvas.getContext('2d');

  let phase = 0;
  let spinAngle = 0;

  function resizeCanvas() {
    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    ctx2d.scale(dpr, dpr);
    if (!state.playing) drawStaticWave();
  }

  function drawHelix(phaseVal, W, H, spin, isStatic) {
    const t = Math.log(state.freq / MIN_HZ) / Math.log(MAX_HZ / MIN_HZ);
    const cycles = 2 + 4 * t;
    const freqStep = (2 * Math.PI * cycles) / W;
    const amplitude = H * 0.32;
    const centerX = W / 2;
    const centerY = H / 2;
    const fov = H * 1.6;
    const step = Math.max(1, Math.floor(W / 360));

    const overScan = Math.ceil(W * 0.25);

    if (!isStatic) {
      ctx2d.save();
      ctx2d.shadowColor = 'rgba(154, 189, 83, 0.45)';
      ctx2d.shadowBlur  = 22;
      ctx2d.strokeStyle = 'rgba(154, 189, 83, 0.13)';
      ctx2d.lineWidth   = 13;
      ctx2d.lineJoin    = 'round';
      ctx2d.lineCap     = 'round';
      const maxJump = amplitude * 0.6;
      let prevGx = null, prevGy = null, pathOpen = false;
      for (let px = -overScan; px <= W + overScan; px += step * 2) {
        const a   = px * freqStep + phaseVal + spin;
        const y3d = amplitude * getSample(a, state.waveType);
        const z3d = amplitude * getSample(a + Math.PI / 2, state.waveType);
        const p   = fov / (fov + z3d);
        const sx  = centerX + (px - centerX) * p;
        const sy  = centerY + y3d * p;
        if (prevGx === null || Math.abs(sy - prevGy) >= maxJump) {
          if (pathOpen) ctx2d.stroke();
          ctx2d.beginPath();
          ctx2d.moveTo(sx, sy);
          pathOpen = true;
        } else {
          ctx2d.lineTo(sx, sy);
        }
        prevGx = sx;
        prevGy = sy;
      }
      if (pathOpen) ctx2d.stroke();
      ctx2d.restore();
    }

    let prevSx = null, prevSy = null, prevZ = null;
    for (let px = -overScan; px <= W + overScan; px += step) {
      const a = px * freqStep + phaseVal + spin;
      const y3d = amplitude * getSample(a, state.waveType);
      const z3d = amplitude * getSample(a + Math.PI / 2, state.waveType);
      const p = fov / (fov + z3d);
      const sx = centerX + (px - centerX) * p;
      const sy = centerY + y3d * p;

      if (prevSx !== null) {
        const avgZ = (z3d + prevZ) / 2;

        const dn = Math.max(0, Math.min(1, (-avgZ + amplitude) / (amplitude * 2)));
        const alpha = isStatic ? (0.06 + dn * 0.28) : (0.08 + dn * 0.92);

        if (dn > 0.5) {
          ctx2d.strokeStyle = `rgba(241, 242, 243, ${alpha.toFixed(2)})`;
          ctx2d.lineWidth = isStatic ? 1.2 : (1.0 + dn * 1.4);
        } else {
          ctx2d.strokeStyle = `rgba(154, 189, 83, ${alpha.toFixed(2)})`;
          ctx2d.lineWidth = isStatic ? 0.8 : 0.9;
        }
        ctx2d.beginPath();
        ctx2d.moveTo(prevSx, prevSy);
        ctx2d.lineTo(sx, sy);
        ctx2d.stroke();
      }
      prevSx = sx; prevSy = sy; prevZ = z3d;
    }
  }

  function drawWaveFrame() {
    const dpr = window.devicePixelRatio || 1;
    const W = canvas.width / dpr;
    const H = canvas.height / dpr;
    ctx2d.clearRect(0, 0, W, H);
    const t = Math.log(state.freq / MIN_HZ) / Math.log(MAX_HZ / MIN_HZ);
    phase += 0.016 + t * 0.06;
    spinAngle += 0.022;
    drawHelix(phase, W, H, spinAngle, false);
    state.animFrame = requestAnimationFrame(drawWaveFrame);
  }

  function drawStaticWave() {
    const dpr = window.devicePixelRatio || 1;
    const W = canvas.width / dpr;
    const H = canvas.height / dpr;
    ctx2d.clearRect(0, 0, W, H);
    drawHelix(phase, W, H, spinAngle, true);
  }

  function getSample(angle, type) {
    switch (type) {
      case 'sine': return Math.sin(angle);
      case 'square': return Math.sign(Math.sin(angle));
      case 'sawtooth': return ((angle % (2 * Math.PI)) / Math.PI) - 1;
      case 'triangle': {
        const p = ((angle % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
        return p < Math.PI ? (p / Math.PI) * 2 - 1 : 3 - (p / Math.PI) * 2;
      }
      default: return Math.sin(angle);
    }
  }

  function startVisualizer() {
    if (state.animFrame) cancelAnimationFrame(state.animFrame);
    drawWaveFrame();
  }

  function stopVisualizer() {
    if (state.animFrame) {
      cancelAnimationFrame(state.animFrame);
      state.animFrame = null;
    }
    drawStaticWave();
  }

  const freqSlider = document.getElementById('freqSlider');
  const freqValueEl = document.getElementById('freqValue');
  const playStopBtn = document.getElementById('playStopBtn');
  const playIcon = document.getElementById('playIcon');
  const stopIcon = document.getElementById('stopIcon');
  const incrementBtn = document.getElementById('incrementBtn');
  const decrementBtn = document.getElementById('decrementBtn');
  const volumeBtn = document.getElementById('volumeBtn');
  const volumeIcon = document.getElementById('volumeIcon');
  const volumePanelEl = document.getElementById('volumePanel');
  const volumeSliderEl = document.getElementById('volumeSlider');
  const channelBtn = document.getElementById('channelBtn');
  const waveBtn = document.getElementById('waveBtn');

  function updatePlayUI() {
    if (state.playing) {
      playIcon.style.display = 'none';
      stopIcon.style.display = 'block';
      playStopBtn.classList.add('playing');
      playStopBtn.setAttribute('aria-label', 'Stop tone');
      playStopBtn.setAttribute('aria-pressed', 'true');
    } else {
      playIcon.style.display = 'block';
      stopIcon.style.display = 'none';
      playStopBtn.classList.remove('playing');
      playStopBtn.setAttribute('aria-label', 'Play tone');
      playStopBtn.setAttribute('aria-pressed', 'false');
    }
  }

  function updateFreqDisplay(hz) {
    if (document.activeElement !== freqValueEl) {
      freqValueEl.value = Math.round(hz);
    }
    freqSlider.setAttribute('aria-valuenow', Math.round(hz));
    freqSlider.setAttribute('aria-valuetext', `${Math.round(hz)} Hz`);
    updateSliderFill(hz);
  }

  function updateSliderFill(hz) {
    const pct = (hzToSlider(hz) / SLIDER_MAX) * 100;
    freqSlider.style.backgroundSize = `${pct}% 100%`;
  }

  function updateVolumeIcon(pct) {
    if (pct === 0) {
      volumeIcon.innerHTML = `
        <path d="M7 8H3a1 1 0 00-1 1v4a1 1 0 001 1h4l5 4V4L7 8z" fill="currentColor"/>
        <line x1="14" y1="8" x2="20" y2="14" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
        <line x1="20" y1="8" x2="14" y2="14" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
      `;
      volumeBtn.style.color = 'var(--text-muted)';
    } else if (pct < 50) {
      volumeIcon.innerHTML = `
        <path d="M7 8H3a1 1 0 00-1 1v4a1 1 0 001 1h4l5 4V4L7 8z" fill="currentColor"/>
        <path d="M15.5 7.5a5 5 0 010 7" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
      `;
      volumeBtn.style.color = '';
    } else {
      volumeIcon.innerHTML = `
        <path d="M7 8H3a1 1 0 00-1 1v4a1 1 0 001 1h4l5 4V4L7 8z" fill="currentColor"/>
        <path d="M15.5 7.5a5 5 0 010 7" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
        <path d="M18 5a9 9 0 010 12" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
      `;
      volumeBtn.style.color = '';
    }
  }

  function updateVolumeSliderFill(pct) {
    volumeSliderEl.style.background =
      `linear-gradient(to top, var(--olive) ${pct}%, #474a4d ${pct}%)`;
  }

  function updateVolumeUI() {
    const pct = Math.round(state.muted ? 0 : state.volume * 100);
    volumeSliderEl.value = pct;
    updateVolumeSliderFill(pct);
    updateVolumeIcon(pct);
    volumeBtn.setAttribute('aria-expanded', volumePanelEl.classList.contains('open') ? 'true' : 'false');
  }

  function updateChannelUI() {
    const channels = ['both', 'left', 'right'];
    const idx = channels.indexOf(state.channel);
    const next = channels[(idx + 1) % channels.length];
    state.channel = next;

    const labels = { both: 'Both channels', left: 'Left channel only', right: 'Right channel only' };
    channelBtn.setAttribute('aria-label', labels[state.channel]);
    channelBtn.setAttribute('aria-pressed', state.channel !== 'both' ? 'true' : 'false');
    updatePan();

    const svgTexts = channelBtn.querySelectorAll('text');
    svgTexts.forEach(t => t.setAttribute('fill', 'currentColor'));

    showToast(labels[state.channel]);
  }

  function cycleWaveType() {
    const idx = WAVE_TYPES.indexOf(state.waveType);
    state.waveType = WAVE_TYPES[(idx + 1) % WAVE_TYPES.length];

    if (oscillator) {
      oscillator.type = state.waveType;
    }
    waveBtn.setAttribute('aria-label', `Waveform: ${WAVE_LABELS[state.waveType]}`);
    showToast(WAVE_LABELS[state.waveType]);
  }

  let toastTimeout = null;
  let toastEl = null;

  function showToast(msg) {
    if (!toastEl) {
      toastEl = document.createElement('div');
      toastEl.className = 'toast';
      toastEl.setAttribute('role', 'status');
      toastEl.setAttribute('aria-live', 'polite');
      document.getElementById('app').appendChild(toastEl);
    }
    toastEl.textContent = msg;
    toastEl.classList.add('visible');
    clearTimeout(toastTimeout);
    toastTimeout = setTimeout(() => toastEl.classList.remove('visible'), 1400);
  }

  freqValueEl.addEventListener('focus', () => {
    freqValueEl.select();
  });

  freqValueEl.addEventListener('change', () => {
    const raw = parseInt(freqValueEl.value, 10);
    const hz = isNaN(raw) ? state.freq : Math.max(1, Math.min(22000, raw));
    state.freq = hz;
    freqSlider.value = hzToSlider(hz);
    updateFreq(hz);
    updateFreqDisplay(hz);
  });

  freqValueEl.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      freqValueEl.blur();
    }
    if (e.key === 'Escape') {
      freqValueEl.value = Math.round(state.freq);
      freqValueEl.blur();
    }
  });

  freqSlider.addEventListener('input', () => {
    const hz = sliderToHz(Number(freqSlider.value));
    updateFreq(hz);
    updateFreqDisplay(hz);
  });

  function applyStep(dir) {
    const hz = Math.max(MIN_HZ, Math.min(MAX_HZ, state.freq + dir));
    state.freq = hz;
    freqSlider.value = hzToSlider(hz);
    updateFreq(hz);
    updateFreqDisplay(hz);
  }

  let holdTimer     = null;
  let holdActive    = false;
  let holdStartTime = 0;

  function getHoldStep(elapsed) {
    if (elapsed < 4000)  return 1;
    if (elapsed < 7000)  return 5;
    if (elapsed < 12000) return 25;
    return 200;
  }

  function getHoldDelay(elapsed) {
    if (elapsed < 4000)  return 80;
    if (elapsed < 7000)  return 65;
    if (elapsed < 12000) return 45;
    return 30;
  }

  function stopHold() {
    holdActive = false;
    clearTimeout(holdTimer);
    holdTimer = null;
  }

  function scheduleNext(dir) {
    if (!holdActive) return;
    const elapsed = Date.now() - holdStartTime;
    holdTimer = setTimeout(() => {
      if (!holdActive) return;
      applyStep(getHoldStep(elapsed) * dir);
      scheduleNext(dir);
    }, getHoldDelay(elapsed));
  }

  function startHold(dir) {
    holdActive    = true;
    holdStartTime = Date.now();
    applyStep(dir);
    holdTimer = setTimeout(() => {
      if (holdActive) scheduleNext(dir);
    }, 380);
  }

  function bindHold(btn, dir) {
    btn.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      btn.setPointerCapture(e.pointerId);
      btn.classList.add('pressed');
      startHold(dir);
    });
    btn.addEventListener('pointerup',     () => { btn.classList.remove('pressed'); stopHold(); });
    btn.addEventListener('pointercancel', () => { btn.classList.remove('pressed'); stopHold(); });
  }

  bindHold(incrementBtn,  1);
  bindHold(decrementBtn, -1);

  playStopBtn.addEventListener('click', () => {
    if (state.playing) {
      stopTone();
    } else {
      startTone();
    }
  });

  function openVolumePanel() {
    const rect = volumeBtn.getBoundingClientRect();
    volumePanelEl.style.left = `${rect.left + rect.width / 2}px`;
    volumePanelEl.style.bottom = `${window.innerHeight - rect.top + 10}px`;
    volumePanelEl.hidden = false;
    volumePanelEl.offsetHeight;
    volumePanelEl.classList.add('open');
    volumeBtn.setAttribute('aria-expanded', 'true');
  }

  function closeVolumePanel() {
    volumePanelEl.classList.remove('open');
    volumeBtn.setAttribute('aria-expanded', 'false');
    setTimeout(() => { volumePanelEl.hidden = true; }, 200);
  }

  volumeBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    volumePanelEl.classList.contains('open') ? closeVolumePanel() : openVolumePanel();
  });

  volumeSliderEl.addEventListener('input', () => {
    const pct = Number(volumeSliderEl.value);
    state.volume = pct / 100;
    state.muted = pct === 0;
    updateGain();
    updateVolumeSliderFill(pct);
    updateVolumeIcon(pct);
  });

  document.addEventListener('click', (e) => {
    if (!volumePanelEl.contains(e.target) && !volumeBtn.contains(e.target)) {
      closeVolumePanel();
    }
  });

  volumePanelEl.addEventListener('click', (e) => e.stopPropagation());

  channelBtn.addEventListener('click', updateChannelUI);

  waveBtn.addEventListener('click', cycleWaveType);

  document.addEventListener('keydown', (e) => {
    if (e.target.tagName === 'INPUT') return;
    switch (e.key) {
      case ' ':
      case 'Enter':
        e.preventDefault();
        playStopBtn.click();
        break;
      case 'ArrowUp':
      case 'ArrowRight':
        e.preventDefault();
        applyStep(e.shiftKey ? 10 : 1);
        break;
      case 'ArrowDown':
      case 'ArrowLeft':
        e.preventDefault();
        applyStep(e.shiftKey ? -10 : -1);
        break;
      case 'm':
      case 'M':
        volumeBtn.click();
        break;
      case 'w':
      case 'W':
        waveBtn.click();
        break;
    }
  });

  function init() {
    updateFreqDisplay(state.freq);
    freqSlider.value = hzToSlider(state.freq);
    updateVolumeUI();
    updatePlayUI();

    const ro = new ResizeObserver(resizeCanvas);
    ro.observe(canvas);
    resizeCanvas();
  }

  init();
})();

