/* ==========================================================================
   ZeroNoise App Core Logic
   ========================================================================== */

document.addEventListener('DOMContentLoaded', () => {
  
  // ==========================================
  // ZeroSlate 연동: URL task 파라미터 확인
  // ==========================================
  const urlParams = new URLSearchParams(window.location.search);
  const taskName = urlParams.get('task');
  const sessionId = urlParams.get('session');
  const hasSuiteContext = urlParams.has('from') || urlParams.has('returnUrl') || urlParams.has('return') || Boolean(taskName || sessionId);
  const suiteSource = urlParams.get('from') || (hasSuiteContext ? 'zeroslate' : 'standalone');
  const suiteDate = urlParams.get('date');
  const requestedMinutes = Number.parseInt(urlParams.get('minutes') || urlParams.get('duration') || '', 10);
  const returnUrl = normalizeSuiteReturnUrl(urlParams.get('returnUrl') || urlParams.get('return'));
  const FOCUS_QUEUE_KEY = 'zeronoise_pending_focus_sessions';
  const suiteStartedAt = new Date().toISOString();
  let suiteClientEventId = createSuiteClientEventId();

  function normalizeSuiteReturnUrl(rawUrl) {
    if (!rawUrl) return 'https://zeroslate.kr';

    try {
      const parsed = new URL(rawUrl, window.location.origin);
      const isAllowedProtocol = parsed.protocol === 'https:' || parsed.protocol === 'http:';
      const isAllowedHost = parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1' || parsed.hostname.endsWith('zeroslate.kr');

      if (isAllowedProtocol && isAllowedHost) {
        return parsed.toString();
      }
    } catch (error) {
      console.warn('ZeroSlate return URL parsing failed:', error);
    }

    return 'https://zeroslate.kr';
  }

  function createSuiteClientEventId() {
    if (window.crypto && typeof window.crypto.randomUUID === 'function') {
      return `zn_${window.crypto.randomUUID()}`;
    }

    return `zn_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
  }

  function buildSuiteReturnUrl(status, actualMinutes, saveStatus, eventId) {
    const target = new URL(returnUrl);
    target.searchParams.set('from', 'noise');
    target.searchParams.set('noiseStatus', status);

    if (sessionId) target.searchParams.set('noiseSession', sessionId);
    if (taskName) target.searchParams.set('task', taskName);
    if (eventId) target.searchParams.set('noiseEvent', eventId);
    if (saveStatus) target.searchParams.set('noiseSaved', saveStatus);
    if (Number.isFinite(actualMinutes) && actualMinutes > 0) {
      target.searchParams.set('actualMinutes', String(actualMinutes));
    }

    return target.toString();
  }

  function mountSuiteBridge() {
    const bridge = document.createElement('a');
    bridge.id = 'suite-return-link';
    bridge.className = 'suite-return-link';
    bridge.href = hasSuiteContext ? buildSuiteReturnUrl('returned') : returnUrl;
    bridge.textContent = '← ZeroSlate로 돌아가기';
    bridge.setAttribute('aria-label', 'ZeroSlate로 돌아가기');

    document.body.appendChild(bridge);
  }

  function markSuiteFocusCompleted(actualMinutes, saveStatus, eventId) {
    const bridge = document.getElementById('suite-return-link');
    if (!bridge) return;

    bridge.href = buildSuiteReturnUrl('completed', actualMinutes, saveStatus, eventId);
    bridge.textContent = saveStatus === 'saved' ? '저장 완료 · ZeroSlate로' : '완료 기록하고 ZeroSlate로';
    bridge.classList.add('is-completed');
  }

  function getFocusSessionsApiUrl() {
    return new URL('/api/focus-sessions', returnUrl).toString();
  }

  function getPendingFocusSessions() {
    try {
      const parsed = JSON.parse(localStorage.getItem(FOCUS_QUEUE_KEY) || '[]');
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  function setPendingFocusSessions(items) {
    localStorage.setItem(FOCUS_QUEUE_KEY, JSON.stringify(items.slice(-20)));
  }

  function enqueueFocusSession(payload) {
    const pending = getPendingFocusSessions();
    if (!pending.some((item) => item.clientEventId === payload.clientEventId)) {
      pending.push(payload);
      setPendingFocusSessions(pending);
    }
  }

  async function sendFocusSession(payload) {
    const response = await fetch(getFocusSessionsApiUrl(), {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      throw new Error(data.error || `focus_session_${response.status}`);
    }

    return response.json();
  }

  async function flushPendingFocusSessions() {
    const pending = getPendingFocusSessions();
    if (pending.length === 0) return;

    const failed = [];
    for (const payload of pending) {
      try {
        await sendFocusSession(payload);
      } catch {
        failed.push(payload);
      }
    }
    setPendingFocusSessions(failed);
  }

  async function persistSuiteFocusSession(actualMinutes, eventId) {
    if (!hasSuiteContext) return 'skipped';

    const plannedMinutes = Math.round(focusDuration / 60);
    const noteCharacters = zenEditor ? zenEditor.textContent.replace(/\s/g, '').length : 0;
    const payload = {
      clientEventId: eventId,
      source: 'zeronoise',
      sourceSessionId: sessionId,
      task: taskName,
      date: suiteDate,
      plannedMinutes,
      actualMinutes,
      noteCharacters,
      startedAt: suiteStartedAt,
      completedAt: new Date().toISOString(),
      metadata: {
        suiteSource,
        requestedMinutes: Number.isFinite(requestedMinutes) ? requestedMinutes : null,
        theme: document.body.className || null
      }
    };

    try {
      await flushPendingFocusSessions();
      await sendFocusSession(payload);
      return 'saved';
    } catch (error) {
      console.warn('ZeroSlate focus session sync pending:', error);
      enqueueFocusSession(payload);
      return 'pending';
    }
  }

  if (taskName) {
    const banner = document.getElementById('task-banner');
    const bannerText = document.getElementById('task-banner-text');
    if (banner && bannerText) {
      bannerText.textContent = `현재 몰입 중: ${taskName}`;
      banner.style.display = 'inline-flex';
    }
  }

  // ==========================================
  // 1. 상태 변수 및 요소 셀렉터
  // ==========================================
  
  // DOM 요소
  const appSlider = document.getElementById('app-slider');
  const btnGotoStats = document.getElementById('btn-goto-stats');
  const btnGotoMain = document.getElementById('btn-goto-main');

  const timerTime = document.getElementById('timer-time');
  const timerStatus = document.getElementById('timer-status');
  const btnTimerStart = document.getElementById('btn-timer-start');
  const btnTimerPause = document.getElementById('btn-timer-pause');
  const btnTimerReset = document.getElementById('btn-timer-reset');
  const circleProgress = document.querySelector('.progress-ring__circle');
  
  const btnAudioToggle = document.getElementById('btn-audio-toggle');
  const checkboxTypewriter = document.getElementById('checkbox-typing-sound');
  const sliderVolume = document.getElementById('slider-volume');
  const sliderNoise = document.getElementById('slider-noise');
  const sliderBinaural = document.getElementById('slider-binaural');
  const sliderRain = document.getElementById('slider-rain');
  const sliderWind = document.getElementById('slider-wind');
  const sliderOcean = document.getElementById('slider-ocean');
  const sliderHugeWave = document.getElementById('slider-huge-wave');
  const sliderNightField = document.getElementById('slider-night-field');
  const sliderFire = document.getElementById('slider-fire');
  const sliderQuietRoom = document.getElementById('slider-quiet-room');
  
  const checkboxRainFilter = document.getElementById('checkbox-rain-filter');
  const checkboxWindFilter = document.getElementById('checkbox-wind-filter');
  const checkboxOceanFilter = document.getElementById('checkbox-ocean-filter');
  const checkboxHugeWaveFilter = document.getElementById('checkbox-huge-wave-filter');
  const checkboxNightFieldFilter = document.getElementById('checkbox-night-field-filter');
  const checkboxFireFilter = document.getElementById('checkbox-fire-filter');
  const checkboxQuietRoomFilter = document.getElementById('checkbox-quiet-room-filter');
  const checkboxTypingSound = document.getElementById('checkbox-typing-sound');
  const themeSelector = document.getElementById('theme-selector');
  
  const zenEditor = document.getElementById('zen-editor');
  const btnZenMode = document.getElementById('btn-zen-mode');
  const btnDailyPrompt = document.getElementById('btn-daily-prompt');
  const btnExportImage = document.getElementById('btn-export-image');
  const btnDownloadTxt = document.getElementById('btn-download-txt');
  const btnDownloadMd = document.getElementById('btn-download-md');
  const btnClearEditor = document.getElementById('btn-clear-editor');
  const btnLibrary = document.getElementById('btn-library');
  const libraryModal = document.getElementById('library-modal');
  const btnCloseModal = document.getElementById('btn-close-modal');
  const libraryList = document.getElementById('library-list');
  const charCountNoSpace = document.getElementById('char-count-no-space');
  const charCountWithSpace = document.getElementById('char-count-with-space');
  
  const statSessions = document.getElementById('stat-sessions');
  const statMinutes = document.getElementById('stat-minutes');
  const statCharacters = document.getElementById('stat-characters');
  const btnResetStats = document.getElementById('btn-reset-stats');
  
  const heatmapContainer = document.getElementById('heatmap-container');
  const breathingModal = document.getElementById('breathing-modal');
  const exportTemplate = document.getElementById('export-template');
  const exportText = document.getElementById('export-text');

  // 시간 설정 슬라이더
  const inputFocusTime = document.getElementById('input-focus-time');
  const inputBreakTime = document.getElementById('input-break-time');
  const valFocusTime = document.getElementById('val-focus-time');
  const valBreakTime = document.getElementById('val-break-time');

  // SVG 원형 게이지 계산용
  const CIRCLE_RADIUS = 85;
  const CIRCLE_CIRCUMFERENCE = 2 * Math.PI * CIRCLE_RADIUS; // ~534
  circleProgress.style.strokeDasharray = CIRCLE_CIRCUMFERENCE;
  circleProgress.style.strokeDashoffset = CIRCLE_CIRCUMFERENCE;

  // 뽀모도로 상태
  let focusDuration = 25 * 60; // 집중 기본 25분 (초 단위)
  let breakDuration = 5 * 60;  // 휴식 기본 5분 (초 단위)
  let timeLeft = focusDuration; 
  let totalDuration = focusDuration;
  let isTimerRunning = false;
  let currentMode = 'focus'; // 'focus' 또는 'break'

  if (Number.isFinite(requestedMinutes) && requestedMinutes > 0) {
    const clampedMinutes = Math.min(60, Math.max(5, requestedMinutes));
    focusDuration = clampedMinutes * 60;
    timeLeft = focusDuration;
    totalDuration = focusDuration;
    if (inputFocusTime) inputFocusTime.value = String(clampedMinutes);
    if (valFocusTime) valFocusTime.textContent = String(clampedMinutes);
  }

  mountSuiteBridge();
  if (hasSuiteContext) {
    flushPendingFocusSessions().catch((error) => {
      console.warn('ZeroSlate pending focus session retry failed:', error);
    });
  }

  // 노트 보관함 상태
  let notes = [];
  try {
    notes = JSON.parse(localStorage.getItem('zeronoise_notes') || '[]');
  } catch(e) {
    notes = [];
  }
  let currentNoteId = localStorage.getItem('zeronoise_current_note_id');

  // 백그라운드 작동을 위한 Blob Web Worker 생성 (로컬 file:// 환경 CORS 제약 우회)
  const workerCode = `
    let timerId = null;
    self.onmessage = function(e) {
      if (e.data.action === 'start') {
        if (timerId) clearInterval(timerId);
        timerId = setInterval(() => {
          self.postMessage({ action: 'tick' });
        }, 1000);
      } else if (e.data.action === 'stop') {
        if (timerId) {
          clearInterval(timerId);
          timerId = null;
        }
      }
    };
  `;
  const blob = new Blob([workerCode], { type: 'application/javascript' });
  const timerWorker = new Worker(URL.createObjectURL(blob));

  // 웹 워커 이벤트 수신
  timerWorker.onmessage = function(e) {
    if (e.data.action === 'tick') {
      handleTimerTick();
    }
  };
  
  // 통계 상태 (로컬 스토리지 연동)
  let stats = {
    sessions: 0,
    minutes: 0,
    characters: 0,
    history: {} // 날짜별 통계 저장용 {"YYYY-MM-DD": minutes}
  };
  
  // 에디터 임시 문자수 추적 (누적 통계 계산용)
  let lastSavedCharCount = 0;

  // ==========================================
  // 2. 로컬 스토리지 통계 관리 (Stats Core)
  // ==========================================
  function loadStats() {
    const saved = localStorage.getItem('zeronoise_stats');
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        stats.sessions = parsed.sessions || 0;
        stats.minutes = parsed.minutes || 0;
        stats.characters = parsed.characters || 0;
        stats.history = parsed.history || {};
      } catch (e) {
        console.error('기록 로드 실패, 초기화합니다.', e);
      }
    }
    updateStatsUI();
  }

  function saveStats() {
    localStorage.setItem('zeronoise_stats', JSON.stringify(stats));
    updateStatsUI();
  }

  function updateStatsUI() {
    statSessions.textContent = `${stats.sessions} 회`;
    statMinutes.textContent = `${stats.minutes} 분`;
    statCharacters.textContent = `${stats.characters} 자`;
    renderHeatmap();
  }

  function getTodayString() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }

  function recordTodayStats(minutes) {
    const today = getTodayString();
    if (!stats.history[today]) {
      stats.history[today] = 0;
    }
    stats.history[today] += minutes;
    saveStats();
  }

  function renderHeatmap() {
    if (!heatmapContainer) return;
    heatmapContainer.innerHTML = '';
    
    // 최근 30일 계산
    const days = 30;
    const today = new Date();
    
    for (let i = days - 1; i >= 0; i--) {
      const d = new Date(today);
      d.setDate(today.getDate() - i);
      const dateStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      
      const mins = stats.history[dateStr] || 0;
      let level = 0;
      if (mins > 0) level = 1;
      if (mins >= 30) level = 2;
      if (mins >= 60) level = 3;
      if (mins >= 120) level = 4;
      
      const cell = document.createElement('div');
      cell.className = 'heatmap-cell';
      cell.dataset.level = level;
      cell.title = `${dateStr}: ${mins}분 집중`;
      
      heatmapContainer.appendChild(cell);
    }
  }

  // ==========================================
  // 배경 테마 로직
  // ==========================================
  function applyTheme(themeValue) {
    document.body.classList.remove('theme-default', 'theme-oled', 'theme-forest', 'theme-ocean', 'theme-nature-blur', 'theme-hybrid');
    if (themeValue !== 'theme-default') {
      document.body.classList.add(themeValue);
    }
    localStorage.setItem('zeroNoiseTheme', themeValue);
    if (themeSelector) themeSelector.value = themeValue;
  }

  if (themeSelector) {
    themeSelector.addEventListener('change', (e) => {
      applyTheme(e.target.value);
    });
    const savedTheme = localStorage.getItem('zeroNoiseTheme');
    if (savedTheme) {
      applyTheme(savedTheme);
    } else {
      applyTheme('theme-hybrid'); // 기본값 하이브리드
    }
  }

  // ==========================================
  // 3. 뽀모도로 타이머 로직 (Timer Core)
  // ==========================================
  function setProgress(percent) {
    const offset = CIRCLE_CIRCUMFERENCE - (percent * CIRCLE_CIRCUMFERENCE);
    circleProgress.style.strokeDashoffset = offset;
  }

  function formatTime(seconds) {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  }

  function updateTimerDisplay() {
    timerTime.textContent = formatTime(timeLeft);
    const percent = timeLeft / totalDuration;
    setProgress(percent);
  }

  // 브라우저 알림 승인 요청
  function requestNotificationPermission() {
    if ('Notification' in window && Notification.permission === 'default') {
      Notification.requestPermission();
    }
  }

  // 데스크톱 브라우저 알림 전송
  function sendNotification(title, message) {
    if ('Notification' in window && Notification.permission === 'granted') {
      try {
        new Notification(title, {
          body: message,
          icon: 'data:image/svg+xml,%3Csvg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg"%3E%3Ccircle cx="50" cy="50" r="45" fill="%230b0f19"/%3E%3Ctext x="50" y="65" font-size="45" text-anchor="middle" fill="%2300f2fe"%3E🔇%3C/text%3E%3C/svg%3E'
        });
      } catch (e) {
        console.error('알림 발송 실패:', e);
      }
    }
  }

  function startTimer() {
    if (isTimerRunning) return;
    
    // 알림 권한 사전 확인 및 오디오 활성화
    requestNotificationPermission();
    if (audioCtx && audioCtx.state === 'suspended') {
      audioCtx.resume();
    }

    btnTimerStart.disabled = true;
    btnTimerPause.disabled = false;
    isTimerRunning = true;

    // 슬라이더 변경 금지
    inputFocusTime.disabled = true;
    inputBreakTime.disabled = true;

    // 타이머 구동 애니메이션 적용을 위한 body 클래스 활성화
    document.body.classList.add('timer-running');

    timerWorker.postMessage({ action: 'start' });
  }

  function handleTimerTick() {
    timeLeft--;
    updateTimerDisplay();
    
    if (timeLeft <= 0) {
      timerWorker.postMessage({ action: 'stop' });
      isTimerRunning = false;
      playAlertSound();
      handleTimerCompletion();
    }
  }

  function pauseTimer() {
    if (!isTimerRunning) return;
    timerWorker.postMessage({ action: 'stop' });
    isTimerRunning = false;
    btnTimerStart.disabled = false;
    btnTimerPause.disabled = true;
    
    // 설정 슬라이더 재활성화
    inputFocusTime.disabled = false;
    inputBreakTime.disabled = false;

    // 애니메이션 비활성화
    document.body.classList.remove('timer-running');
  }

  function resetTimer() {
    pauseTimer();
    if (currentMode === 'focus') {
      timeLeft = focusDuration;
      totalDuration = focusDuration;
      timerStatus.textContent = '집중 시간';
      circleProgress.style.stroke = 'var(--primary-color)';
    } else {
      timeLeft = breakDuration;
      totalDuration = breakDuration;
      timerStatus.textContent = '휴식 시간';
      circleProgress.style.stroke = 'var(--accent-color)';
    }
    updateTimerDisplay();
  }

  function handleTimerCompletion() {
    btnTimerStart.disabled = false;
    btnTimerPause.disabled = true;
    
    inputFocusTime.disabled = false;
    inputBreakTime.disabled = false;

    if (currentMode === 'focus') {
      // 집중 세션 완료
      stats.sessions += 1;
      const focusedMinutes = Math.round(focusDuration / 60);
      stats.minutes += focusedMinutes;
      if (hasSuiteContext) {
        const completedEventId = suiteClientEventId;
        suiteClientEventId = createSuiteClientEventId();
        markSuiteFocusCompleted(focusedMinutes, 'pending', completedEventId);
        persistSuiteFocusSession(focusedMinutes, completedEventId).then((saveStatus) => {
          markSuiteFocusCompleted(focusedMinutes, saveStatus, completedEventId);
        });
      }
      
      // 작성 중인 글자수도 최종 반영
      const currentCharCount = zenEditor.textContent.replace(/\s/g, '').length;
      const addedChars = Math.max(0, currentCharCount - lastSavedCharCount);
      stats.characters += addedChars;
      lastSavedCharCount = currentCharCount;
      
      saveStats();
      recordTodayStats(focusedMinutes); // 30일 잔디 심기 기록 업데이트
      
      // 휴식 모드로 전환
      currentMode = 'break';
      timeLeft = breakDuration;
      totalDuration = breakDuration;
      timerStatus.textContent = `휴식 시간 (${Math.round(breakDuration / 60)}분)`;
      circleProgress.style.stroke = 'var(--accent-color)';
      
      sendNotification('ZeroNoise 집중 완료!', '아주 훌륭합니다! 🧘 푹 쉬며 머리를 식혀보세요.');
      
      // 심호흡 애니메이션 모달 띄우기 (60초간)
      if (breathingModal) {
        breathingModal.classList.remove('hidden');
        setTimeout(() => {
          breathingModal.classList.add('hidden');
        }, 60000); // 1분 후 자동 닫힘
      }
    } else {
      // 휴식 완료
      currentMode = 'focus';
      timeLeft = focusDuration;
      totalDuration = focusDuration;
      timerStatus.textContent = `집중 시간 (${Math.round(focusDuration / 60)}분)`;
      circleProgress.style.stroke = 'var(--primary-color)';
      
      sendNotification('ZeroNoise 휴식 종료!', '휴식이 완료되었습니다. 다시 몰입할 시간입니다! 🔥');
      setTimeout(() => alert('휴식이 완료되었습니다. 다시 집중 모드에 돌입해 볼까요? 🔥'), 50);
    }
    document.body.classList.remove('timer-running');
    updateTimerDisplay();
  }

  // ==========================================
  // 4. Web Audio API 오디오 합성 (Web Audio Core)
  // ==========================================
  let audioCtx = null;
  let noiseNode = null;
  let gainNode = null;
  let filterNode = null;
  let isPlayingAudio = false;

  // 바람 소리용 합성 노드들
  let windSource = null;
  let windFilter = null;
  let windGain = null;
  let windInterval = null;

  // 2초 분량의 오디오 버퍼 생성 후 노이즈 주파수 주입
  function createNoiseBuffer(type) {
    if (!audioCtx) return null;
    
    const bufferSize = audioCtx.sampleRate * 2; // 2초 분량
    const buffer = audioCtx.createBuffer(1, bufferSize, audioCtx.sampleRate);
    const data = buffer.getChannelData(0);

    if (type === 'white') {
      // White Noise: 완전 난수
      for (let i = 0; i < bufferSize; i++) {
        data[i] = Math.random() * 2 - 1;
      }
    } else if (type === 'pink') {
      // Pink Noise: Kellet의 알고리즘 필터링 적용
      let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
      for (let i = 0; i < bufferSize; i++) {
        let white = Math.random() * 2 - 1;
        b0 = 0.99886 * b0 + white * 0.0555179;
        b1 = 0.99332 * b1 + white * 0.0750759;
        b2 = 0.96900 * b2 + white * 0.1538520;
        b3 = 0.86650 * b3 + white * 0.3104856;
        b4 = 0.55000 * b4 + white * 0.5329522;
        b5 = -0.7616 * b5 - white * 0.0168980;
        data[i] = b0 + b1 + b2 + b3 + b4 + b5 + b6 + white * 0.5362;
        data[i] *= 0.11; // 클리핑 방지 게인
        b6 = white * 0.115926;
      }
    } else if (type === 'brown') {
      // Brown Noise: 누적 이동 평균
      let lastOut = 0.0;
      for (let i = 0; i < bufferSize; i++) {
        let white = Math.random() * 2 - 1;
        data[i] = (lastOut + (0.02 * white)) / 1.02;
        lastOut = data[i];
        data[i] *= 3.5; // 볼륨 복원 게인
      }
    }
    return buffer;
  }

  const naturalAudioBoosts = {
    rain: 16,
    wind: 8,
    ocean: 2,
    hugeWave: 1.4,
    nightField: 6,
    fire: 10,
    quietRoom: 16
  };
  let naturalAudioRoutes = [];

  function initAudio() {
    if (audioCtx) return;
    
    // AudioContext 생성
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    
    // 기본 노이즈 볼륨 조절용 GainNode 생성
    gainNode = audioCtx.createGain();
    // 백색소음을 확 줄여 자연의 소리가 상대적으로 훨씬 크게 들리도록 0.2배로 설정
    gainNode.gain.setValueAtTime(parseFloat(sliderVolume.value) * parseFloat(sliderNoise.value) * 0.2, audioCtx.currentTime);
    gainNode.connect(audioCtx.destination);

    // Normalize uneven source levels without re-encoding the ambient files.
    naturalAudioRoutes = Object.entries(audioFiles).map(([name, audio]) => {
      try {
        const source = audioCtx.createMediaElementSource(audio);
        const boost = audioCtx.createGain();
        const compressor = audioCtx.createDynamicsCompressor();
        boost.gain.value = naturalAudioBoosts[name] || 1;
        compressor.threshold.value = -18;
        compressor.knee.value = 12;
        compressor.ratio.value = 12;
        compressor.attack.value = 0.003;
        compressor.release.value = 0.25;
        source.connect(boost);
        boost.connect(compressor);
        compressor.connect(audioCtx.destination);
        return { source, boost, compressor };
      } catch (error) {
        console.warn(`Natural audio routing failed: ${name}`, error);
        return null;
      }
    }).filter(Boolean);
  }

  // ==========================================
  // 뇌파 동조 (Binaural Beats) 로직
  // ==========================================
  let binauralOscLeft = null;
  let binauralOscRight = null;
  let binauralGain = null;
  let binauralMerger = null;

  function stopBinauralBeats() {
    if (binauralOscLeft) { try { binauralOscLeft.stop(); } catch(e){} binauralOscLeft.disconnect(); binauralOscLeft = null; }
    if (binauralOscRight) { try { binauralOscRight.stop(); } catch(e){} binauralOscRight.disconnect(); binauralOscRight = null; }
    if (binauralMerger) { binauralMerger.disconnect(); binauralMerger = null; }
    if (binauralGain) { binauralGain.disconnect(); binauralGain = null; }
  }

  function startBinauralBeats() {
    const binauralRadio = document.querySelector('input[name="binaural-type"]:checked');
    if (!binauralRadio) return;
    const selectedBinaural = binauralRadio.value;
    
    stopBinauralBeats();
    if (selectedBinaural === 'none') return;
    
    if (!audioCtx) initAudio();
    
    const baseFreq = 200; // 편안한 200Hz 대역
    let diffFreq = 0;
    if (selectedBinaural === 'alpha') diffFreq = 10;
    else if (selectedBinaural === 'theta') diffFreq = 6;
    
    binauralGain = audioCtx.createGain();
    // 개별 믹서 볼륨 반영
    binauralGain.gain.setValueAtTime(parseFloat(sliderVolume.value) * parseFloat(sliderBinaural.value) * 0.2, audioCtx.currentTime);
    binauralGain.connect(audioCtx.destination);
    
    binauralMerger = audioCtx.createChannelMerger(2);
    binauralMerger.connect(binauralGain);
    
    binauralOscLeft = audioCtx.createOscillator();
    binauralOscLeft.type = 'sine';
    binauralOscLeft.frequency.value = baseFreq;
    binauralOscLeft.connect(binauralMerger, 0, 0); // 좌측
    
    binauralOscRight = audioCtx.createOscillator();
    binauralOscRight.type = 'sine';
    binauralOscRight.frequency.value = baseFreq + diffFreq;
    binauralOscRight.connect(binauralMerger, 0, 1); // 우측
    
    binauralOscLeft.start();
    binauralOscRight.start();
  }

  function startSelectedNaturalSounds() {
    const naturalSounds = [
      [checkboxRainFilter, startRain],
      [checkboxWindFilter, startWindLFO],
      [checkboxOceanFilter, startOceanLFO],
      [checkboxHugeWaveFilter, startHugeWave],
      [checkboxNightFieldFilter, startNightField],
      [checkboxFireFilter, startFireplace],
      [checkboxQuietRoomFilter, startQuietRoom]
    ];

    naturalSounds.forEach(([checkbox, start]) => {
      if (checkbox?.checked) start();
    });
  }

  function startAudio() {
    try {
      // Keep media.play() inside the original user gesture on mobile browsers.
      startSelectedNaturalSounds();
      initAudio();
      if (audioCtx.state === 'suspended') {
        audioCtx.resume();
      }

      const selectedType = document.querySelector('input[name="noise-type"]:checked').value;
      
      if (selectedType !== 'none') {
        const buffer = createNoiseBuffer(selectedType);
        if (buffer) {
          noiseNode = audioCtx.createBufferSource();
          noiseNode.buffer = buffer;
          noiseNode.loop = true;
          noiseNode.connect(gainNode);

          const volScale = sliderVolume ? parseFloat(sliderVolume.value) : 1.0;
          const noiseScale = sliderNoise ? parseFloat(sliderNoise.value) : 0.2;
          const targetVolume = volScale * noiseScale * 0.2;
          
          gainNode.gain.setValueAtTime(0, audioCtx.currentTime);
          gainNode.gain.linearRampToValueAtTime(targetVolume, audioCtx.currentTime + 0.15);

          noiseNode.start(0);
        }
      }
      isPlayingAudio = true;
      
      startBinauralBeats();

      if (btnAudioToggle) {
        btnAudioToggle.innerHTML = '<span class="play-icon">⏸</span> 정지';
        btnAudioToggle.classList.add('active');
      }
    } catch (err) {
      console.error("Audio playback error:", err);
      alert("오디오 재생 오류가 발생했습니다: " + err.message);
      isPlayingAudio = false;
      if (btnAudioToggle) {
        btnAudioToggle.innerHTML = '<span class="play-icon">▶</span> 재생';
        btnAudioToggle.classList.remove('active');
      }
    }
  }

  function stopAudio() {
    if (noiseNode) {
      try { noiseNode.stop(); } catch(e) {}
      noiseNode.disconnect();
      noiseNode = null;
    }
    isPlayingAudio = false;

    stopRain();
    stopWindLFO();
    stopOceanLFO();
    stopFireplace();
    stopHugeWave();
    stopNightField();
    stopQuietRoom();
    stopBinauralBeats();

    btnAudioToggle.innerHTML = '<span class="play-icon">▶</span> 재생';
    btnAudioToggle.classList.remove('active');
  }

  // ==========================================
  // 실제 오디오 파일 재생 로직 (자연의 소리)
  // ==========================================
  const audioFiles = {
    rain: new Audio('기본사운드/rain.mp3'),
    wind: new Audio('기본사운드/wind.mp3'),
    ocean: new Audio('기본사운드/night_wave.mp3'),
    hugeWave: new Audio('기본사운드/huge_wave.mp3'),
    nightField: new Audio('기본사운드/night_field.mp3'),
    fire: new Audio('기본사운드/fire.mp3'),
    quietRoom: new Audio('기본사운드/quiet_room.mp3')
  };

  // 루프 설정
  [audioFiles.rain, audioFiles.wind, audioFiles.ocean, audioFiles.hugeWave, audioFiles.nightField, audioFiles.fire, audioFiles.quietRoom].forEach(audio => {
    audio.loop = true;
    audio.preload = 'auto';
    audio.playsInline = true;
  });

  const naturalAudioControls = [
    [checkboxRainFilter, audioFiles.rain],
    [checkboxWindFilter, audioFiles.wind],
    [checkboxOceanFilter, audioFiles.ocean],
    [checkboxHugeWaveFilter, audioFiles.hugeWave],
    [checkboxNightFieldFilter, audioFiles.nightField],
    [checkboxFireFilter, audioFiles.fire],
    [checkboxQuietRoomFilter, audioFiles.quietRoom]
  ];

  function primeNaturalAudio(audio) {
    if (!audio || !audio.paused) return;

    audio.volume = 0;
    const playback = audio.play();
    playback?.catch(() => {
      // The click handler retries and exposes a visible retry state if needed.
    });
  }

  naturalAudioControls.forEach(([checkbox, audio]) => {
    checkbox?.closest('.toggle-switch')?.addEventListener('pointerdown', () => {
      primeNaturalAudio(audio);
    }, { passive: true });
  });

  btnAudioToggle?.addEventListener('pointerdown', () => {
    naturalAudioControls.forEach(([checkbox, audio]) => {
      if (checkbox?.checked) primeNaturalAudio(audio);
    });
  }, { passive: true });

  // 페이드 인 함수
  function fadeAudioIn(audio, maxVol) {
    if (audio.fadeInterval) clearInterval(audio.fadeInterval);
    audio.volume = 0;
    const beginFade = () => {
      let vol = 0;
      audio.fadeInterval = setInterval(() => {
        vol += 0.05;
        if (vol >= maxVol) {
          audio.volume = maxVol;
          clearInterval(audio.fadeInterval);
        } else {
          audio.volume = vol;
        }
      }, 50);
    };

    const playback = audio.play();
    if (!playback || typeof playback.then !== 'function') {
      beginFade();
      return;
    }

    playback.then(beginFade).catch((error) => {
      console.warn('Natural audio playback failed:', error);
      audio.volume = 0;
      isPlayingAudio = false;
      btnAudioToggle.innerHTML = '<span class="play-icon">▶</span> 다시 재생';
      btnAudioToggle.classList.remove('active');
    });
  }

  // 페이드 아웃 함수
  function fadeAudioOut(audio) {
    if (audio.fadeInterval) clearInterval(audio.fadeInterval);
    let vol = audio.volume;
    audio.fadeInterval = setInterval(() => {
      vol -= 0.05;
      if (vol <= 0) {
        audio.volume = 0;
        audio.pause();
        clearInterval(audio.fadeInterval);
      } else {
        audio.volume = vol;
      }
    }, 50);
  }

  // 볼륨 동기화 헬퍼 함수
  function getAdjustedVolume(baseVol) {
    const globalVol = parseFloat(sliderVolume.value);
    // 볼륨이 1.0을 넘지 않도록 제한
    return Math.min(1.0, baseVol * globalVol);
  }

  function startRain() { fadeAudioIn(audioFiles.rain, getAdjustedVolume(sliderRain ? parseFloat(sliderRain.value) : 1.0)); }
  function stopRain() { fadeAudioOut(audioFiles.rain); }

  function startWindLFO() { fadeAudioIn(audioFiles.wind, getAdjustedVolume(sliderWind ? parseFloat(sliderWind.value) : 1.0)); }
  function stopWindLFO() { fadeAudioOut(audioFiles.wind); }

  function startOceanLFO() { fadeAudioIn(audioFiles.ocean, getAdjustedVolume(sliderOcean ? parseFloat(sliderOcean.value) : 1.0)); }
  function stopOceanLFO() { fadeAudioOut(audioFiles.ocean); }

  function startFireplace() { fadeAudioIn(audioFiles.fire, getAdjustedVolume(sliderFire ? parseFloat(sliderFire.value) : 1.0)); }
  function stopFireplace() { fadeAudioOut(audioFiles.fire); }

  function startHugeWave() { fadeAudioIn(audioFiles.hugeWave, getAdjustedVolume(sliderHugeWave ? parseFloat(sliderHugeWave.value) : 1.0)); }
  function stopHugeWave() { fadeAudioOut(audioFiles.hugeWave); }

  function startNightField() { fadeAudioIn(audioFiles.nightField, getAdjustedVolume(sliderNightField ? parseFloat(sliderNightField.value) : 1.0)); }
  function stopNightField() { fadeAudioOut(audioFiles.nightField); }

  function startQuietRoom() { fadeAudioIn(audioFiles.quietRoom, getAdjustedVolume(sliderQuietRoom ? parseFloat(sliderQuietRoom.value) : 1.0)); }
  function stopQuietRoom() { fadeAudioOut(audioFiles.quietRoom); }

  // 기계식 키보드 청청(탁탁) 클릭음 합성
  function playTypingSound() {
    if (!audioCtx) initAudio();
    if (audioCtx.state === 'suspended') {
      audioCtx.resume();
    }

    // 클릭 요소 (고주파 "탁" 소리)
    const oscClick = audioCtx.createOscillator();
    const gainClick = audioCtx.createGain();
    const filterClick = audioCtx.createBiquadFilter();

    oscClick.type = 'triangle';
    oscClick.frequency.setValueAtTime(950, audioCtx.currentTime);
    oscClick.frequency.exponentialRampToValueAtTime(120, audioCtx.currentTime + 0.04);

    filterClick.type = 'bandpass';
    filterClick.frequency.setValueAtTime(1100, audioCtx.currentTime);
    filterClick.Q.setValueAtTime(4.5, audioCtx.currentTime);

    gainClick.gain.setValueAtTime(0.06, audioCtx.currentTime);
    gainClick.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.04);

    // 바디 통울림 요소 (저주파 "둥/쿵" 소리)
    const oscBody = audioCtx.createOscillator();
    const gainBody = audioCtx.createGain();

    oscBody.type = 'sine';
    // 약간의 타건음 랜덤 피치 부여 (자연스러움 극대화)
    const pitchOffset = Math.random() * 20 - 10;
    oscBody.frequency.setValueAtTime(130 + pitchOffset, audioCtx.currentTime);
    oscBody.frequency.linearRampToValueAtTime(90 + pitchOffset, audioCtx.currentTime + 0.07);

    gainBody.gain.setValueAtTime(0.1, audioCtx.currentTime);
    gainBody.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.07);

    // 연결 및 출력
    oscClick.connect(filterClick);
    filterClick.connect(gainClick);
    gainClick.connect(audioCtx.destination);

    oscBody.connect(gainBody);
    gainBody.connect(audioCtx.destination);

    oscClick.start();
    oscBody.start();
    oscClick.stop(audioCtx.currentTime + 0.04);
    oscBody.stop(audioCtx.currentTime + 0.07);
  }

  // 주파수 타입 변경 시 즉시 교체
  function handleNoiseTypeChange() {
    if (isPlayingAudio) {
      // 기존 소리를 멈춘 후 즉각 재시작
      if (noiseNode) {
        try { noiseNode.stop(); } catch(e) {}
        noiseNode.disconnect();
        noiseNode = null;
      }
      
      const selectedType = document.querySelector('input[name="noise-type"]:checked').value;
      if (selectedType !== 'none') {
        const buffer = createNoiseBuffer(selectedType);
        if (buffer) {
          noiseNode = audioCtx.createBufferSource();
          noiseNode.buffer = buffer;
          noiseNode.loop = true;
          noiseNode.connect(gainNode);
          noiseNode.start(0);
        }
      }
    }
  }

  // 알림 사운드 합성 (25분 완료 시 띵동 소리)
  function playAlertSound() {
    if (!audioCtx) initAudio();
    if (audioCtx.state === 'suspended') audioCtx.resume();

    const osc1 = audioCtx.createOscillator();
    const osc2 = audioCtx.createOscillator();
    const alertGain = audioCtx.createGain();

    osc1.type = 'sine';
    osc1.frequency.setValueAtTime(523.25, audioCtx.currentTime); // C5 (도)
    osc1.frequency.setValueAtTime(659.25, audioCtx.currentTime + 0.15); // E5 (미)
    osc1.frequency.setValueAtTime(783.99, audioCtx.currentTime + 0.3); // G5 (솔)

    osc2.type = 'sine';
    osc2.frequency.setValueAtTime(261.63, audioCtx.currentTime); // C4 (낮은 도)
    osc2.frequency.setValueAtTime(329.63, audioCtx.currentTime + 0.15); // E4
    osc2.frequency.setValueAtTime(392.00, audioCtx.currentTime + 0.3); // G4

    alertGain.gain.setValueAtTime(0.3, audioCtx.currentTime);
    alertGain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.8);

    osc1.connect(alertGain);
    osc2.connect(alertGain);
    alertGain.connect(audioCtx.destination);

    osc1.start();
    osc2.start();
    osc1.stop(audioCtx.currentTime + 0.8);
    osc2.stop(audioCtx.currentTime + 0.8);
  }

  // ==========================================
  // 5. 젠 라이터 (Zen Writer Core)
  // ==========================================
  
  // 디바운스 헬퍼 함수
  function debounce(func, wait) {
    let timeout;
    return function executedFunction(...args) {
      const later = () => {
        clearTimeout(timeout);
        func(...args);
      };
      clearTimeout(timeout);
      timeout = setTimeout(later, wait);
    };
  }

  // 에디터가 완전히 비었을 때 기본적으로 첫 div 요소를 생성하여
  // 초기 줄 구조가 갖춰지도록 구성
  function initializeEditor() {
    if (zenEditor.innerHTML === '' || zenEditor.innerHTML === '<br>') {
      const firstDiv = document.createElement('div');
      firstDiv.classList.add('current-line');
      zenEditor.innerHTML = '';
      zenEditor.appendChild(firstDiv);
    }
  }

  // 현재 커서가 위치한 줄을 감지하여 .current-line 클래스를 부여
  function updateActiveLine() {
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0) return;

    const range = selection.getRangeAt(0);
    let node = range.startContainer;

    // 텍스트 노드라면 부모 요소로 이동
    if (node.nodeType === Node.TEXT_NODE) {
      node = node.parentElement;
    }

    // zenEditor 의 직접 자식 div까지 올라감
    while (node && node !== zenEditor && node.parentElement !== zenEditor) {
      node = node.parentElement;
    }

    // 기존 current-line 클래스 전부 제거
    zenEditor.querySelectorAll('div.current-line').forEach(div => {
      div.classList.remove('current-line');
    });

    // 현재 줄에만 current-line 부여
    if (node && node !== zenEditor && node.parentElement === zenEditor) {
      node.classList.add('current-line');
    }
  }

  // 노트 제목 추출 헬퍼 함수
  function extractTitle(html) {
    const tempDiv = document.createElement('div');
    tempDiv.innerHTML = html;
    const text = tempDiv.textContent.trim();
    if (!text) return '새로운 빈 글';
    return text.length > 20 ? text.substring(0, 20) + '...' : text;
  }

  // 에디터 본문 자동 저장 (디바운스 적용)
  const saveEditorContent = debounce(() => {
    if (!currentNoteId) return;
    const html = zenEditor.innerHTML;
    const title = extractTitle(html);
    const noteIndex = notes.findIndex(n => n.id === currentNoteId);
    
    if (noteIndex >= 0) {
      notes[noteIndex].content = html;
      notes[noteIndex].title = title;
      notes[noteIndex].updatedAt = Date.now();
    } else {
      notes.push({ id: currentNoteId, title, content: html, updatedAt: Date.now() });
    }
    localStorage.setItem('zeronoise_notes', JSON.stringify(notes));
    if (typeof renderLibraryList === 'function') renderLibraryList();
  }, 1000);

  // 에디터 본문 불러오기
  function loadEditorContent() {
    // 마이그레이션: 기존 단일 데이터가 있고 notes가 비어있으면 전환
    const oldSaved = localStorage.getItem('zeronoise_editor_content');
    if (oldSaved && notes.length === 0) {
      currentNoteId = Date.now().toString();
      notes.push({ id: currentNoteId, title: extractTitle(oldSaved), content: oldSaved, updatedAt: Date.now() });
      localStorage.setItem('zeronoise_notes', JSON.stringify(notes));
      localStorage.setItem('zeronoise_current_note_id', currentNoteId);
      localStorage.removeItem('zeronoise_editor_content');
    }

    if (!currentNoteId && notes.length > 0) {
      notes.sort((a, b) => b.updatedAt - a.updatedAt);
      currentNoteId = notes[0].id;
      localStorage.setItem('zeronoise_current_note_id', currentNoteId);
    }

    const currentNote = notes.find(n => n.id === currentNoteId);
    if (currentNote) {
      zenEditor.innerHTML = currentNote.content;
    } else {
      createNewNote(true);
    }
    updateCharCounts();
    const text = zenEditor.textContent || '';
    lastSavedCharCount = text.replace(/\s/g, '').length;
  }

  // 글자 수 세기 화면 반영
  function updateCharCounts() {
    const text = zenEditor.textContent || '';
    const lengthWithSpace = text.length;
    const lengthNoSpace = text.replace(/\s/g, '').length;
    
    charCountWithSpace.textContent = lengthWithSpace;
    charCountNoSpace.textContent = lengthNoSpace;
  }

  function handleEditorInput() {
    const text = zenEditor.textContent || '';
    const lengthNoSpace = text.replace(/\s/g, '').length;
    
    updateCharCounts();
    saveEditorContent(); // 텍스트 변경 시 저장 스케줄러 작동

    // 디바운스 방식으로 최종 저장 데이터의 증가분을 누적 통계에 실시간 업데이트
    // 입력할 때마다 실시간 기록이 1씩 누적되는 것을 방지하기 위해 실시간 차이 계산
    const diff = lengthNoSpace - lastSavedCharCount;
    if (diff > 0) {
      stats.characters += diff;
      lastSavedCharCount = lengthNoSpace;
      // 너무 잦은 쓰기를 방지하기 위해 입력 시 화면에는 누적 반영하되 
      // 로컬 스토리지 저장은 타이머 마침이나 브라우저 이탈 시 혹은 주기적 세션 완료 시 처리
      updateStatsUI();
    } else {
      // 텍스트를 지운 경우, 누적 값을 깎지 않고 임시 기준치만 낮춰서 
      // 새로 치는 글자만 다시 누적되도록 함
      lastSavedCharCount = lengthNoSpace;
    }
    
    // 10글자 입력 시마다 로컬 스토리지에 가볍게 자동 저장
    if (lengthNoSpace % 10 === 0) {
      saveStats();
    }
  }

  // 새 글 작성 기능 (기존 글 보존 후 새 캔버스 열기)
  function createNewNote(isInitial = false) {
    if (!isInitial && currentNoteId) {
      saveEditorContent(); // 기존 글 강제 저장
    }
    currentNoteId = Date.now().toString();
    localStorage.setItem('zeronoise_current_note_id', currentNoteId);
    zenEditor.innerHTML = '';
    initializeEditor();
    
    // 빈 노트 즉시 생성
    notes.push({ id: currentNoteId, title: '새로운 빈 글', content: zenEditor.innerHTML, updatedAt: Date.now() });
    localStorage.setItem('zeronoise_notes', JSON.stringify(notes));
    if (typeof renderLibraryList === 'function') renderLibraryList();
    
    updateCharCounts();
    lastSavedCharCount = 0;
  }

  // 에디터 비우기 기능 (새 글 작성)
  function clearEditor() {
    createNewNote(false);
    saveStats();
  }

  // 파일 다운로드 핵심 로직
  function downloadContent(fileExtension) {
    const lines = Array.from(zenEditor.querySelectorAll('div')).map(div => div.textContent);
    
    let fullText = "";
    if (lines.length > 0) {
      fullText = lines.join('\n');
    } else {
      fullText = zenEditor.textContent || "";
    }

    if (!fullText.trim()) {
      alert('다운로드할 내용이 없습니다. 먼저 글을 작성해 보세요!');
      return;
    }

    const mimeType = fileExtension === 'md' ? 'text/markdown;charset=utf-8' : 'text/plain;charset=utf-8';
    const blob = new Blob([fullText], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    
    const now = new Date();
    const dateStr = `${now.getFullYear()}${String(now.getMonth()+1).padStart(2,'0')}${String(now.getDate()).padStart(2,'0')}_${String(now.getHours()).padStart(2,'0')}${String(now.getMinutes()).padStart(2,'0')}`;
    
    link.href = url;
    link.download = `ZeroNoise_FocusLog_${dateStr}.${fileExtension}`;
    link.click();
    
    URL.revokeObjectURL(url);
  }

  // ==========================================
  // 6. 이벤트 리스너 등록
  // ==========================================
  
  // 타이머 관련
  btnTimerStart.addEventListener('click', startTimer);
  btnTimerPause.addEventListener('click', pauseTimer);
  btnTimerReset.addEventListener('click', resetTimer);

  // 타이머 설정 변경 이벤트 바인딩
  inputFocusTime.addEventListener('input', (e) => {
    const mins = parseInt(e.target.value);
    valFocusTime.textContent = mins;
    focusDuration = mins * 60;
    if (!isTimerRunning && currentMode === 'focus') {
      timeLeft = focusDuration;
      totalDuration = focusDuration;
      updateTimerDisplay();
    }
  });

  inputBreakTime.addEventListener('input', (e) => {
    const mins = parseInt(e.target.value);
    valBreakTime.textContent = mins;
    breakDuration = mins * 60;
    if (!isTimerRunning && currentMode === 'break') {
      timeLeft = breakDuration;
      totalDuration = breakDuration;
      updateTimerDisplay();
    }
  });
  
  // 사운드 관련
  btnAudioToggle.addEventListener('click', () => {
    if (isPlayingAudio) {
      stopAudio();
    } else {
      startAudio();
    }
  });

  function updateAllVolumes() {
    const masterVol = parseFloat(sliderVolume.value);
    if (gainNode) gainNode.gain.setValueAtTime(masterVol * parseFloat(sliderNoise.value) * 0.2, audioCtx.currentTime);
    if (binauralGain && audioCtx) binauralGain.gain.setValueAtTime(masterVol * parseFloat(sliderBinaural.value) * 0.2, audioCtx.currentTime);
    
    if (isPlayingAudio) {
      if (checkboxRainFilter && checkboxRainFilter.checked) audioFiles.rain.volume = getAdjustedVolume(sliderRain ? parseFloat(sliderRain.value) : 1.0);
      if (checkboxWindFilter && checkboxWindFilter.checked) audioFiles.wind.volume = getAdjustedVolume(sliderWind ? parseFloat(sliderWind.value) : 1.0);
      if (checkboxOceanFilter && checkboxOceanFilter.checked) audioFiles.ocean.volume = getAdjustedVolume(sliderOcean ? parseFloat(sliderOcean.value) : 1.0);
      if (checkboxHugeWaveFilter && checkboxHugeWaveFilter.checked) audioFiles.hugeWave.volume = getAdjustedVolume(sliderHugeWave ? parseFloat(sliderHugeWave.value) : 1.0);
      if (checkboxNightFieldFilter && checkboxNightFieldFilter.checked) audioFiles.nightField.volume = getAdjustedVolume(sliderNightField ? parseFloat(sliderNightField.value) : 1.0);
      if (checkboxFireFilter && checkboxFireFilter.checked) audioFiles.fire.volume = getAdjustedVolume(sliderFire ? parseFloat(sliderFire.value) : 1.0);
      if (checkboxQuietRoomFilter && checkboxQuietRoomFilter.checked) audioFiles.quietRoom.volume = getAdjustedVolume(sliderQuietRoom ? parseFloat(sliderQuietRoom.value) : 1.0);
    }
  }

  [sliderVolume, sliderNoise, sliderBinaural, sliderRain, sliderWind, sliderOcean, sliderHugeWave, sliderNightField, sliderFire, sliderQuietRoom].forEach(slider => {
    if (slider) {
      slider.addEventListener('input', updateAllVolumes);
    }
  });

  document.querySelectorAll('input[name="noise-type"]').forEach(radio => {
    radio.addEventListener('change', handleNoiseTypeChange);
  });

  checkboxRainFilter.addEventListener('change', (e) => {
    if (e.target.checked && !isPlayingAudio) {
      startAudio();
    } else if (isPlayingAudio) {
      if (e.target.checked) startRain();
      else stopRain();
    }
  });

  checkboxWindFilter.addEventListener('change', (e) => {
    if (e.target.checked && !isPlayingAudio) {
      startAudio();
    } else if (isPlayingAudio) {
      if (e.target.checked) startWindLFO();
      else stopWindLFO();
    }
  });

  checkboxOceanFilter.addEventListener('change', (e) => {
    if (e.target.checked && !isPlayingAudio) {
      startAudio();
    } else if (isPlayingAudio) {
      if (e.target.checked) startOceanLFO();
      else stopOceanLFO();
    }
  });

  if (checkboxFireFilter) {
    checkboxFireFilter.addEventListener('change', (e) => {
      if (e.target.checked && !isPlayingAudio) startAudio();
      else if (isPlayingAudio) {
        if (e.target.checked) startFireplace();
        else stopFireplace();
      }
    });
  }
  if (checkboxHugeWaveFilter) {
    checkboxHugeWaveFilter.addEventListener('change', (e) => {
      if (e.target.checked && !isPlayingAudio) startAudio();
      else if (isPlayingAudio) {
        if (e.target.checked) startHugeWave();
        else stopHugeWave();
      }
    });
  }
  if (checkboxNightFieldFilter) {
    checkboxNightFieldFilter.addEventListener('change', (e) => {
      if (e.target.checked && !isPlayingAudio) startAudio();
      else if (isPlayingAudio) {
        if (e.target.checked) startNightField();
        else stopNightField();
      }
    });
  }
  if (checkboxQuietRoomFilter) {
    checkboxQuietRoomFilter.addEventListener('change', (e) => {
      if (e.target.checked && !isPlayingAudio) startAudio();
      else if (isPlayingAudio) {
        if (e.target.checked) startQuietRoom();
        else stopQuietRoom();
      }
    });
  }

  // 에디터 관련 키 입력 시 기계식 타이핑 사운드 재생
  zenEditor.addEventListener('keydown', (e) => {
    if (checkboxTypingSound.checked && !e.ctrlKey && !e.metaKey && !e.altKey) {
      // 제어용 단독 키 입력 제외
      const ignoreKeys = ['Shift', 'Control', 'Alt', 'Meta', 'CapsLock', 'Escape', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'];
      if (!ignoreKeys.includes(e.key)) {
        playTypingSound();
      }
    }
  });

  // 에디터 관련
  zenEditor.addEventListener('input', (e) => {
    handleEditorInput(e);
    updateActiveLine(); // 입력 후 현재 줄 재감지
  });
  zenEditor.addEventListener('keyup', updateActiveLine);   // 방향키/엔터 이동 후 줄 재감지
  zenEditor.addEventListener('mouseup', updateActiveLine); // 마우스 클릭으로 줄 이동 후 재감지
  zenEditor.addEventListener('focus', () => {
    initializeEditor();
    zenEditor.classList.add('is-focused');
    updateActiveLine();
  });
  zenEditor.addEventListener('blur', () => {
    zenEditor.classList.remove('is-focused');
    zenEditor.querySelectorAll('div.current-line').forEach(div => {
      div.classList.remove('current-line');
    });
  });

  // 오늘의 영감 (Daily Prompts)
  const prompts = [
    "오늘 가장 기대되는 일은 무엇인가요?",
    "지금 머릿속을 맴도는 걱정거리가 있다면 적어보세요.",
    "당신이 가장 좋아하는 장소를 눈앞에 그리듯 묘사해보세요.",
    "10년 전의 나에게 딱 한 문장만 전할 수 있다면?",
    "오늘 나를 미소 짓게 만든 작은 순간이 있었나요?",
    "지금 당장 떠나고 싶은 여행지는 어디인가요? 왜 그곳인가요?",
    "아무런 조건 없이 이룰 수 있다면 가장 하고 싶은 일은?",
    "최근에 읽은 책이나 영화에서 인상 깊었던 대사는 무엇인가요?"
  ];

  btnDailyPrompt.addEventListener('click', () => {
    const randomPrompt = prompts[Math.floor(Math.random() * prompts.length)];
    const div = document.createElement('div');
    div.textContent = `💡 ${randomPrompt}`;
    div.style.color = 'var(--text-muted)';
    div.style.fontStyle = 'italic';
    zenEditor.appendChild(div);
    const emptyDiv = document.createElement('div');
    emptyDiv.innerHTML = '<br>';
    zenEditor.appendChild(emptyDiv);
    
    // 에디터 포커싱 및 스크롤 이동
    zenEditor.focus();
    const sel = window.getSelection();
    sel.selectAllChildren(emptyDiv);
    sel.collapseToEnd();
    updateActiveLine();
  });

  // 이미지로 저장 (html2canvas)
  btnExportImage.addEventListener('click', () => {
    const textContent = zenEditor.innerText || zenEditor.textContent;
    if (!textContent.trim()) {
      alert("이미지로 저장할 내용이 없습니다.");
      return;
    }
    
    // 원래 버튼 텍스트 저장 및 로딩 표시
    const originalText = btnExportImage.innerHTML;
    btnExportImage.innerHTML = "⏳ 생성 중...";
    btnExportImage.disabled = true;

    // 숨김 템플릿에 데이터 채우기
    exportText.textContent = textContent;
    
    // html2canvas가 렌더링할 수 있도록 잠시 보이게 함 (화면 밖)
    exportTemplate.style.top = '0';
    exportTemplate.style.left = '0';
    exportTemplate.style.zIndex = '-1';
    
    html2canvas(exportTemplate, {
      backgroundColor: null, // 투명 배경 허용
      scale: 2 // 고해상도
    }).then(canvas => {
      const link = document.createElement('a');
      const now = new Date();
      const dateStr = `${now.getFullYear()}${String(now.getMonth()+1).padStart(2,'0')}${String(now.getDate()).padStart(2,'0')}`;
      link.download = `ZeroNoise_Quote_${dateStr}.png`;
      link.href = canvas.toDataURL("image/png");
      link.click();
      
      // 원상 복구
      exportTemplate.style.top = '-9999px';
      exportTemplate.style.left = '-9999px';
      exportTemplate.style.zIndex = '';
      btnExportImage.innerHTML = originalText;
      btnExportImage.disabled = false;
    }).catch(err => {
      console.error("이미지 저장 중 오류:", err);
      alert("이미지 저장에 실패했습니다.");
      btnExportImage.innerHTML = originalText;
      btnExportImage.disabled = false;
    });
  });
  btnDownloadTxt.addEventListener('click', () => downloadContent('txt'));
  btnDownloadMd.addEventListener('click', () => downloadContent('md'));
  btnClearEditor.addEventListener('click', clearEditor);
  btnZenMode.addEventListener('click', () => {
    const isZen = document.body.classList.toggle('zen-mode-active');
    if (isZen) {
      btnZenMode.innerHTML = '🧘 일반 모드';
      btnZenMode.classList.add('active');
      if (document.documentElement.requestFullscreen) {
        document.documentElement.requestFullscreen().catch(e => console.log('Fullscreen error:', e));
      }
    } else {
      btnZenMode.innerHTML = '🧘 젠 모드';
      btnZenMode.classList.remove('active');
      if (document.fullscreenElement && document.exitFullscreen) {
        document.exitFullscreen().catch(e => console.log('Exit fullscreen error:', e));
      }
    }
  });

  // 전체화면 해제 시 젠 모드도 자동 해제
  document.addEventListener('fullscreenchange', () => {
    if (!document.fullscreenElement && document.body.classList.contains('zen-mode-active')) {
      document.body.classList.remove('zen-mode-active');
      btnZenMode.innerHTML = '🧘 젠 모드';
      btnZenMode.classList.remove('active');
    }
  });

  // 젠 모드에서 Esc 누르면 복귀 (Fullscreen API가 없는 경우 대비 백폴)
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && document.body.classList.contains('zen-mode-active') && !document.fullscreenElement) {
      document.body.classList.remove('zen-mode-active');
      btnZenMode.innerHTML = '🧘 젠 모드';
      btnZenMode.classList.remove('active');
    }
  });

  // 사운드 믹스 프리셋 로직
  const builtInPresets = {
    deepFocus: {
      noiseType: 'white', noiseVol: 0.2,
      binauralType: 'theta', binauralVol: 0.2,
      rain: true, rainVol: 1.0,
      wind: false, windVol: 1.0,
      ocean: false, oceanVol: 1.0,
      fire: false, fireVol: 1.0
    },
    cozyCabin: {
      noiseType: 'brown', noiseVol: 0.3,
      binauralType: 'none', binauralVol: 0.2,
      rain: true, rainVol: 0.8,
      wind: true, windVol: 0.7,
      ocean: false, oceanVol: 1.0,
      fire: true, fireVol: 1.0
    },
    stormyNight: {
      noiseType: 'none', noiseVol: 0.2,
      binauralType: 'none', binauralVol: 0.2,
      rain: true, rainVol: 1.0,
      wind: true, windVol: 1.0,
      ocean: true, oceanVol: 0.9,
      fire: false, fireVol: 1.0
    }
  };

  function applyPresetConfig(config) {
    document.querySelector(`input[name="noise-type"][value="${config.noiseType || 'none'}"]`).checked = true;
    document.querySelector(`input[name="binaural-type"][value="${config.binauralType || 'none'}"]`).checked = true;
    
    sliderNoise.value = config.noiseVol !== undefined ? config.noiseVol : 0.2;
    sliderBinaural.value = config.binauralVol !== undefined ? config.binauralVol : 0.2;

    checkboxRainFilter.checked = !!config.rain;
    sliderRain.value = config.rainVol !== undefined ? config.rainVol : 1.0;

    checkboxWindFilter.checked = !!config.wind;
    sliderWind.value = config.windVol !== undefined ? config.windVol : 1.0;

    checkboxOceanFilter.checked = !!config.ocean;
    sliderOcean.value = config.oceanVol !== undefined ? config.oceanVol : 1.0;

    if (checkboxHugeWaveFilter) checkboxHugeWaveFilter.checked = !!config.hugeWave;
    if (sliderHugeWave) sliderHugeWave.value = config.hugeWaveVol !== undefined ? config.hugeWaveVol : 1.0;

    if (checkboxNightFieldFilter) checkboxNightFieldFilter.checked = !!config.nightField;
    if (sliderNightField) sliderNightField.value = config.nightFieldVol !== undefined ? config.nightFieldVol : 1.0;

    checkboxFireFilter.checked = !!config.fire;
    sliderFire.value = config.fireVol !== undefined ? config.fireVol : 1.0;

    if (checkboxQuietRoomFilter) checkboxQuietRoomFilter.checked = !!config.quietRoom;
    if (sliderQuietRoom) sliderQuietRoom.value = config.quietRoomVol !== undefined ? config.quietRoomVol : 1.0;

    handleNoiseTypeChange();
    
    if (isPlayingAudio) {
      // 실시간 재생중이라면 껐다 켜서 모든 효과를 동기화
      stopAudio();
      setTimeout(startAudio, 50);
    } else {
      startAudio();
    }
  }

  document.querySelectorAll('.preset-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const preset = e.target.dataset.preset;
      if (builtInPresets[preset]) {
        applyPresetConfig(builtInPresets[preset]);
      }
    });
  });

  // 커스텀 프리셋 기능
  const btnSaveCustomPreset = document.getElementById('btn-save-custom-preset');
  const presetContainer = document.getElementById('preset-container');

  function loadCustomPresets() {
    // 기존 커스텀 버튼 제거
    document.querySelectorAll('.custom-preset-btn').forEach(btn => btn.remove());
    
    const presetsJSON = localStorage.getItem('zenCustomPresets');
    if (presetsJSON) {
      try {
        const presets = JSON.parse(presetsJSON);
        presets.forEach((preset, index) => {
          const btn = document.createElement('button');
          btn.className = 'btn btn-sm btn-outline custom-preset-btn';
          btn.innerHTML = `${preset.name} <span class="delete-preset" data-index="${index}" style="margin-left:4px; color:#ff6b6b; cursor:pointer;" title="삭제">×</span>`;
          btn.style.borderColor = 'rgba(100, 200, 255, 0.4)';
          btn.style.color = 'rgba(200, 230, 255, 0.9)';
          
          btn.addEventListener('click', (e) => {
            if (e.target.classList.contains('delete-preset')) {
              e.stopPropagation();
              const p = JSON.parse(localStorage.getItem('zenCustomPresets'));
              p.splice(index, 1);
              localStorage.setItem('zenCustomPresets', JSON.stringify(p));
              loadCustomPresets();
              return;
            }
            applyPresetConfig(preset.config);
          });
          
          presetContainer.appendChild(btn);
        });
      } catch (e) {
        console.error('Failed to load custom presets', e);
      }
    }
  }

  if (btnSaveCustomPreset && presetContainer) {
    btnSaveCustomPreset.addEventListener('click', () => {
      const name = prompt('저장할 커스텀 믹스의 이름을 입력해주세요:', '내 커스텀 믹스');
      if (!name) return;
      
      const currentConfig = {
        noiseType: document.querySelector('input[name="noise-type"]:checked').value,
        noiseVol: sliderNoise.value,
        binauralType: document.querySelector('input[name="binaural-type"]:checked').value,
        binauralVol: sliderBinaural.value,
        rain: checkboxRainFilter.checked,
        rainVol: sliderRain.value,
        wind: checkboxWindFilter.checked,
        windVol: sliderWind.value,
        ocean: checkboxOceanFilter.checked,
        oceanVol: sliderOcean.value,
        hugeWave: checkboxHugeWaveFilter ? checkboxHugeWaveFilter.checked : false,
        hugeWaveVol: sliderHugeWave ? sliderHugeWave.value : 1.0,
        nightField: checkboxNightFieldFilter ? checkboxNightFieldFilter.checked : false,
        nightFieldVol: sliderNightField ? sliderNightField.value : 1.0,
        fire: checkboxFireFilter.checked,
        fireVol: sliderFire.value,
        quietRoom: checkboxQuietRoomFilter ? checkboxQuietRoomFilter.checked : false,
        quietRoomVol: sliderQuietRoom ? sliderQuietRoom.value : 1.0
      };

      let presets = [];
      const presetsJSON = localStorage.getItem('zenCustomPresets');
      if (presetsJSON) {
        presets = JSON.parse(presetsJSON);
      }
      presets.push({ name, config: currentConfig });
      localStorage.setItem('zenCustomPresets', JSON.stringify(presets));
      
      loadCustomPresets();
    });

    // 초기 로드
    loadCustomPresets();
  }

  // 뇌파 동조(Binaural Beats) 라디오 리스너
  document.querySelectorAll('input[name="binaural-type"]').forEach(radio => {
    radio.addEventListener('change', () => {
      if (!isPlayingAudio) {
        startAudio();
      } else {
        startBinauralBeats();
      }
    });
  });

  // 성과 초기화 버튼
  btnResetStats.addEventListener('click', () => {
    if (confirm('오늘의 몰입 성과 기록을 모두 초기화할까요?')) {
      stats = { sessions: 0, minutes: 0, characters: 0 };
      lastSavedCharCount = 0;
      saveStats();
    }
  });

  // 브라우저 닫기/새로고침 시 마지막 글자수 반영 및 저장
  window.addEventListener('beforeunload', () => {
    saveStats();
  });

  // 보관함 모달 및 로직
  function renderLibraryList() {
    libraryList.innerHTML = '';
    const sortedNotes = [...notes].sort((a, b) => b.updatedAt - a.updatedAt);
    
    if (sortedNotes.length === 0) {
      libraryList.innerHTML = '<li style="text-align:center; color:var(--text-muted); padding:2rem;">보관된 글이 없습니다.</li>';
      return;
    }

    sortedNotes.forEach(note => {
      const li = document.createElement('li');
      li.className = 'library-item';
      if (note.id === currentNoteId) li.classList.add('active');

      const dateStr = new Date(note.updatedAt).toLocaleString('ko-KR', {
        month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit'
      });

      li.innerHTML = `
        <div class="library-item-info">
          <span class="library-item-title">${note.title || '제목 없음'}</span>
          <span class="library-item-date">${dateStr}</span>
        </div>
        <button class="btn-delete-note" aria-label="노트 삭제" data-id="${note.id}">🗑️</button>
      `;

      // 노트 전환
      li.addEventListener('click', (e) => {
        if (e.target.closest('.btn-delete-note')) return; // 삭제 버튼 클릭 시 무시
        switchNote(note.id);
      });

      // 노트 삭제
      li.querySelector('.btn-delete-note').addEventListener('click', (e) => {
        e.stopPropagation();
        deleteNote(note.id);
      });

      libraryList.appendChild(li);
    });
  }

  function switchNote(id) {
    if (currentNoteId) saveEditorContent(); // 현재 글 임시 저장
    currentNoteId = id;
    localStorage.setItem('zeronoise_current_note_id', currentNoteId);
    loadEditorContent();
    libraryModal.classList.add('hidden');
  }

  function deleteNote(id) {
    if (!confirm('이 글을 삭제하시겠습니까? 복구할 수 없습니다.')) return;
    notes = notes.filter(n => n.id !== id);
    localStorage.setItem('zeronoise_notes', JSON.stringify(notes));
    if (currentNoteId === id) {
      currentNoteId = null;
      localStorage.removeItem('zeronoise_current_note_id');
      loadEditorContent();
    } else {
      renderLibraryList();
    }
  }

  btnLibrary.addEventListener('click', () => {
    renderLibraryList();
    libraryModal.classList.remove('hidden');
  });

  btnCloseModal.addEventListener('click', () => {
    libraryModal.classList.add('hidden');
  });

  libraryModal.addEventListener('click', (e) => {
    if (e.target === libraryModal) {
      libraryModal.classList.add('hidden');
    }
  });

  // ==========================================
  // 7. 페이지 네비게이션 로직 (Slide)
  // ==========================================
  btnGotoStats.addEventListener('click', () => {
    appSlider.style.transform = 'translateX(-100vw)';
  });

  btnGotoMain.addEventListener('click', () => {
    appSlider.style.transform = 'translateX(0)';
  });

  // ==========================================
  // 8. 앱 초기화 실행
  // ==========================================
  loadStats();
  updateTimerDisplay();
  loadEditorContent();

});

// ==========================================
// 사운드스케이프 탭 전환 함수 (전역)
// ==========================================
window.switchSoundTab = function(pageId, btnElement) {
  // 모든 탭 버튼 활성화 해제
  const allTabs = document.querySelectorAll('.sound-tab-btn');
  allTabs.forEach(tab => tab.classList.remove('active'));
  
  // 클릭된 버튼 활성화
  btnElement.classList.add('active');
  
  // 모든 사운드 페이지 숨김
  const allPages = document.querySelectorAll('.sound-page');
  allPages.forEach(page => page.classList.remove('active'));
  
  // 선택된 사운드 페이지 표시
  const targetPage = document.getElementById(pageId);
  if (targetPage) {
    targetPage.classList.add('active');
  }
};
