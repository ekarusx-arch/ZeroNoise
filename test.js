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

window.addEventListener('error', (event) => runtimeErrors.push(event.error || event.message));
window.matchMedia = (query) => ({
  matches: query.includes('max-width'),
  media: query,
  addEventListener() {},
  removeEventListener() {}
});
window.scrollTo = () => {};
window.URL.createObjectURL = () => 'blob:zeronoise-timer';
window.Worker = class {
  postMessage() {}
  terminate() {}
};
window.Audio = class {
  play() { return Promise.resolve(); }
  pause() {}
};
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

assert.match(html, /viewport-fit=cover/);
assert.match(html, /id="mobile-app-nav"/);
assert.match(mobileCss, /env\(safe-area-inset-bottom/);
assert.match(mobileCss, /100svh/);
assert.match(serviceWorkerSource, /CACHE_AUDIO/);
assert.match(serviceWorkerSource, /mobile-app\.js/);

assert.equal(manifest.display, 'standalone');
assert.equal(manifest.scope, './');
assert.ok(manifest.shortcuts.some((shortcut) => shortcut.url.includes('view=write')));
assert.ok(manifest.icons.some((icon) => icon.purpose === 'maskable'));

manifest.icons.forEach((icon) => {
  assert.equal(icon.src.startsWith('data:'), false);
  assert.equal(fs.existsSync(path.join(root, icon.src)), true, `Missing icon: ${icon.src}`);
});

console.log('ZeroNoise mobile/PWA smoke test passed.');
