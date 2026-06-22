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

const dom = new JSDOM(html, {
  runScripts: 'outside-only',
  url: 'https://noise.zeroslate.kr/?view=focus'
});
const { window } = dom;
const runtimeErrors = [];
const audioEvents = [];

window.addEventListener('error', (event) => runtimeErrors.push(event.error || event.message));
window.matchMedia = (query) => ({
  matches: query.includes('max-width'),
  media: query,
  addEventListener() {},
  removeEventListener() {}
});
window.scrollTo = () => {};
window.PointerEvent = window.Event;
window.URL.createObjectURL = () => 'blob:zeronoise-timer';
window.Worker = class {
  postMessage() {}
  terminate() {}
};
window.Audio = class {
  constructor(src) { this.src = src; this.volume = 1; this.paused = true; }
  load() {}
  play() { return Promise.resolve(); }
  pause() {
    this.paused = true;
    audioEvents.push(`pause:${this.src}`);
  }
};
window.Audio.prototype.play = function play() {
  this.paused = false;
  audioEvents.push(`play:${this.src}`);
  return Promise.resolve();
};
window.AudioContext = class {
  constructor() {
    audioEvents.push('context');
    this.state = 'suspended';
    this.currentTime = 0;
    this.destination = {};
  }
  createGain() {
    return {
      gain: { value: 1, setValueAtTime() {}, linearRampToValueAtTime() {} },
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
  resume() { this.state = 'running'; return Promise.resolve(); }
};
window.webkitAudioContext = window.AudioContext;
window.confirm = () => true;
window.alert = () => {};

window.eval(appSource);
window.eval(mobileSource);
window.document.dispatchEvent(new window.Event('DOMContentLoaded', { bubbles: true }));

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
