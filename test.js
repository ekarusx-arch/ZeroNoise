const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

const root = __dirname;
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const appSource = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
const mobileSource = fs.readFileSync(path.join(root, 'mobile-app.js'), 'utf8');
const mobileCss = fs.readFileSync(path.join(root, 'mobile.css'), 'utf8');
const serviceWorkerSource = fs.readFileSync(path.join(root, 'sw.js'), 'utf8');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));

function jsonResponse(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async json() {
      return body;
    }
  };
}

function waitForAsyncWork(turns = 6) {
  let chain = Promise.resolve();
  for (let i = 0; i < turns; i += 1) {
    chain = chain.then(() => new Promise((resolve) => setTimeout(resolve, 0)));
  }
  return chain;
}

function createEnvironment(options = {}) {
  const {
    url = 'https://noise.zeroslate.kr/?view=focus',
    fetchImpl = async () => {
      throw new Error('Unexpected fetch');
    },
    includeMobile = false
  } = options;
  const dom = new JSDOM(html, {
    runScripts: 'outside-only',
    url
  });
  const { window } = dom;
  const runtimeErrors = [];
  const audioEvents = [];
  const fetchCalls = [];
  const workerInstances = [];
  const domContentLoadedListeners = [];
  const originalDocumentAddEventListener = window.document.addEventListener.bind(window.document);

  window.addEventListener('error', (event) => runtimeErrors.push(event.error || event.message));
  window.document.addEventListener = (type, listener, options) => {
    if (type === 'DOMContentLoaded') {
      domContentLoadedListeners.push(listener);
      return;
    }
    return originalDocumentAddEventListener(type, listener, options);
  };
  window.matchMedia = (query) => ({
    matches: query.includes('max-width'),
    media: query,
    addEventListener() {},
    removeEventListener() {}
  });
  window.scrollTo = () => {};
  window.PointerEvent = window.Event;
  window.URL.createObjectURL = () => 'blob:zeronoise-timer';
  window.crypto = { randomUUID: () => 'suite-test-uuid' };
  window.Notification = { permission: 'denied', requestPermission() { return Promise.resolve('denied'); } };
  window.Blob = class {
    constructor(parts, config) {
      this.parts = parts;
      this.config = config;
    }
  };
  window.Worker = class {
    constructor() {
      this.messages = [];
      this.onmessage = null;
      workerInstances.push(this);
    }
    postMessage(message) {
      this.messages.push(message);
    }
    terminate() {}
  };
  window.Audio = class {
    constructor(src) {
      this.src = src;
      this.volume = 1;
      this.paused = true;
    }
    load() {}
    play() {
      this.paused = false;
      audioEvents.push(`play:${this.src}`);
      return Promise.resolve();
    }
    pause() {
      this.paused = true;
      audioEvents.push(`pause:${this.src}`);
    }
  };
  window.AudioContext = class {
    constructor() {
      audioEvents.push('context');
      this.state = 'suspended';
      this.currentTime = 0;
      this.destination = {};
    }
    createOscillator() {
      return {
        type: 'sine',
        frequency: { value: 0, setValueAtTime() {}, linearRampToValueAtTime() {}, exponentialRampToValueAtTime() {} },
        connect() {},
        disconnect() {},
        start() {},
        stop() {}
      };
    }
    createGain() {
      return {
        gain: { value: 1, setValueAtTime() {}, linearRampToValueAtTime() {}, exponentialRampToValueAtTime() {} },
        connect() {},
        disconnect() {}
      };
    }
    createBiquadFilter() {
      return {
        type: 'lowpass',
        frequency: { value: 0, setValueAtTime() {}, linearRampToValueAtTime() {} },
        Q: { value: 0 },
        gain: { value: 0 },
        connect() {},
        disconnect() {}
      };
    }
    createBufferSource() {
      return {
        buffer: null,
        loop: false,
        connect() {},
        disconnect() {},
        start() {},
        stop() {}
      };
    }
    createBuffer(channels, length) {
      return {
        getChannelData() {
          return new Float32Array(length);
        }
      };
    }
    createStereoPanner() {
      return {
        pan: { value: 0, setValueAtTime() {}, linearRampToValueAtTime() {} },
        connect() {},
        disconnect() {}
      };
    }
    createMediaElementSource() { return { connect() {} }; }
    createDynamicsCompressor() {
      return {
        threshold: { value: 0 },
        knee: { value: 0 },
        ratio: { value: 0 },
        attack: { value: 0 },
        release: { value: 0 },
        connect() {}
      };
    }
    resume() {
      this.state = 'running';
      return Promise.resolve();
    }
  };
  window.webkitAudioContext = window.AudioContext;
  window.confirm = () => true;
  window.alert = () => {};
  window.fetch = async (input, init = {}) => {
    fetchCalls.push({ input, init });
    return fetchImpl(input, init, window);
  };

  window.eval(appSource);
  if (includeMobile) {
    window.eval(mobileSource);
  }
  domContentLoadedListeners.forEach((listener) => {
    listener.call(window.document, new window.Event('DOMContentLoaded', { bubbles: true }));
  });
  window.document.addEventListener = originalDocumentAddEventListener;

  return { dom, window, runtimeErrors, audioEvents, fetchCalls, workerInstances };
}

async function testMobilePwaSmoke() {
  const env = createEnvironment({ includeMobile: true });
  const { window, runtimeErrors, audioEvents } = env;

  await waitForAsyncWork();

  assert.equal(runtimeErrors.length, 0, `Runtime errors: ${runtimeErrors.join(', ')}`);
  assert.equal(window.document.body.dataset.mobileView, 'focus');

  const soundTab = window.document.querySelector('[data-mobile-view="sound"]');
  soundTab.click();
  assert.equal(window.document.body.dataset.mobileView, 'sound');
  assert.equal(window.document.querySelector('.sound-card').classList.contains('collapsed'), false);
  assert.equal(soundTab.getAttribute('aria-current'), 'page');

  const editor = window.document.getElementById('zen-editor');
  editor.dispatchEvent(new window.FocusEvent('focusin', { bubbles: true }));
  assert.equal(window.document.body.classList.contains('editor-keyboard-active'), true);
  editor.dispatchEvent(new window.FocusEvent('focusout', { bubbles: true }));
  assert.equal(window.document.body.classList.contains('editor-keyboard-active'), false);

  const rainCheckbox = window.document.getElementById('checkbox-rain-filter');
  rainCheckbox.closest('.toggle-switch').dispatchEvent(new window.PointerEvent('pointerdown', { bubbles: true }));
  rainCheckbox.checked = true;
  rainCheckbox.dispatchEvent(new window.Event('change', { bubbles: true }));
  const rainPlayIndex = audioEvents.findIndex((event) => event.includes('rain.mp3'));
  const contextIndex = audioEvents.indexOf('context');
  assert.ok(rainPlayIndex >= 0, 'Rain audio should attempt playback.');
  assert.ok(rainPlayIndex < contextIndex, 'Natural audio playback must start before AudioContext initialization.');
  assert.match(appSource, /rain: 16/);
  assert.match(appSource, /createDynamicsCompressor/);

  const stormyNightButton = window.document.querySelector('[data-preset="stormyNight"]');
  const playsBeforeStormyNight = audioEvents.filter((event) => event.startsWith('play:')).length;
  stormyNightButton.click();
  const playsAfterStormyNight = audioEvents.filter((event) => event.startsWith('play:')).length;
  assert.ok(
    playsAfterStormyNight > playsBeforeStormyNight,
    'Stormy Night must restart natural audio synchronously inside the preset click.'
  );

  const pausesBeforeRepeatedStormyNight = audioEvents.filter((event) => event.startsWith('pause:')).length;
  const playsBeforeRepeatedStormyNight = audioEvents.filter((event) => event.startsWith('play:')).length;
  stormyNightButton.click();
  assert.equal(
    audioEvents.filter((event) => event.startsWith('pause:')).length,
    pausesBeforeRepeatedStormyNight,
    'Selecting the active Stormy Night preset again must not pause its audio.'
  );
  assert.equal(
    audioEvents.filter((event) => event.startsWith('play:')).length,
    playsBeforeRepeatedStormyNight,
    'Selecting the active Stormy Night preset again must not restart its audio.'
  );

  window.close();
}

async function testSuiteCodeExchangeAndBearerAuth() {
  const env = createEnvironment({
    url: 'https://noise.zeroslate.kr/?suiteCode=abc123&from=zeroslate&returnUrl=http%3A%2F%2Flocalhost%3A3000%2Fapp&minutes=5',
    fetchImpl: async (input, init) => {
      const url = String(input);
      if (url === 'https://zeroslate.kr/api/auth/suite/exchange') {
        return jsonResponse(200, { access_token: 'suite-token' });
      }
      if (url.includes('/api/zeronoise/state')) {
        if (init.method === 'GET') {
          return jsonResponse(200, { ok: true, user: { email: 'pro@zeroslate.kr' } });
        }
        return jsonResponse(200, { ok: true });
      }
      if (url.includes('/api/focus-sessions')) {
        return jsonResponse(200, { ok: true });
      }
      throw new Error(`Unexpected fetch for ${input}`);
    }
  });
  const { window, runtimeErrors, fetchCalls, workerInstances } = env;

  await waitForAsyncWork(10);

  assert.equal(runtimeErrors.length, 0, `Runtime errors: ${runtimeErrors.join(', ')}`);
  assert.equal(window.location.search.includes('suiteCode='), false, 'suiteCode should be removed from the URL.');

  const exchangeCall = fetchCalls.find((call) => String(call.input) === 'https://zeroslate.kr/api/auth/suite/exchange');
  assert.ok(exchangeCall, 'suiteCode exchange request should be sent.');
  assert.equal(exchangeCall.init.method, 'POST');
  assert.deepEqual(JSON.parse(exchangeCall.init.body), { code: 'abc123' });

  const stateCalls = fetchCalls.filter((call) => String(call.input).includes('/api/zeronoise/state'));
  assert.ok(stateCalls.length >= 2, 'state GET and initial state save should both run.');
  stateCalls.forEach((call) => {
    assert.equal(new URL(String(call.input)).origin, 'https://zeroslate.kr');
    assert.equal(call.init.credentials, 'include');
    assert.equal(call.init.headers.Authorization, 'Bearer suite-token');
  });

  const startButton = window.document.getElementById('btn-timer-start');
  startButton.click();
  const timerWorker = workerInstances.at(-1);
  assert.ok(timerWorker, 'Timer worker should exist.');
  for (let i = 0; i < 300; i += 1) {
    timerWorker.onmessage({ data: { action: 'tick' } });
  }
  await waitForAsyncWork(12);

  const focusCall = fetchCalls.find((call) => String(call.input).includes('/api/focus-sessions'));
  assert.ok(focusCall, 'focus session should be sent after timer completion.');
  assert.equal(new URL(String(focusCall.input)).origin, 'https://zeroslate.kr');
  assert.equal(focusCall.init.credentials, 'include');
  assert.equal(focusCall.init.headers.Authorization, 'Bearer suite-token');

  window.close();
}

async function testSuiteCodeExchangeFailureFallsBack() {
  const env = createEnvironment({
    url: 'https://noise.zeroslate.kr/?suiteCode=bad-code&from=zeroslate&returnUrl=https%3A%2F%2Fzeroslate.kr%2Fapp',
    fetchImpl: async (input) => {
      if (String(input) === 'https://zeroslate.kr/api/auth/suite/exchange') {
        return jsonResponse(401, { error: 'invalid_code' });
      }
      if (String(input).includes('/api/zeronoise/state')) {
        return jsonResponse(401, { error: 'unauthorized' });
      }
      throw new Error(`Unexpected fetch: ${input}`);
    }
  });
  const { window, runtimeErrors, fetchCalls } = env;

  await waitForAsyncWork(8);

  assert.equal(runtimeErrors.length, 0, `Runtime errors: ${runtimeErrors.join(', ')}`);
  assert.equal(window.location.search.includes('suiteCode='), false, 'suiteCode should be removed even after failure.');
  assert.equal(window.document.getElementById('account-mode-text').textContent, '로그인 필요');
  assert.equal(window.document.body.classList.contains('guest-mode'), true);

  const stateCall = fetchCalls.find((call) => String(call.input).includes('/api/zeronoise/state'));
  assert.ok(stateCall, 'fallback state check should still run.');
  assert.equal(stateCall.init.headers.Authorization, undefined);
  assert.equal(stateCall.init.credentials, 'include');

  window.close();
}

async function main() {
  await testMobilePwaSmoke();
  await testSuiteCodeExchangeAndBearerAuth();
  await testSuiteCodeExchangeFailureFallsBack();

  assert.match(html, /viewport-fit=cover/);
  assert.match(html, /id="mobile-app-nav"/);
  assert.match(mobileCss, /env\(safe-area-inset-bottom/);
  assert.match(mobileCss, /100svh/);
  assert.match(serviceWorkerSource, /CACHE_AUDIO/);
  assert.match(serviceWorkerSource, /mobile-app\.js/);
  assert.match(serviceWorkerSource, /request\.headers\.get\('range'\)/);
  assert.match(serviceWorkerSource, /status: 206/);

  assert.equal(manifest.display, 'standalone');
  assert.equal(manifest.scope, './');
  assert.ok(manifest.shortcuts.some((shortcut) => shortcut.url.includes('view=write')));
  assert.ok(manifest.icons.some((icon) => icon.purpose === 'maskable'));

  manifest.icons.forEach((icon) => {
    assert.equal(icon.src.startsWith('data:'), false);
    assert.equal(fs.existsSync(path.join(root, icon.src)), true, `Missing icon: ${icon.src}`);
  });

  console.log('ZeroNoise mobile/PWA smoke test passed.');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
