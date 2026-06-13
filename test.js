const fs = require('fs');
const jsdom = require('jsdom');
const { JSDOM } = jsdom;

const html = fs.readFileSync('index.html', 'utf-8');
let js = fs.readFileSync('app.js', 'utf-8');

// Inject try/catch inside startAudio
js = js.replace('function startAudio() {', 'function startAudio() { try { console.log("startAudio called");');
js = js.replace(/btnAudioToggle\.classList\.add\('active'\);\s*\}/, 'btnAudioToggle.classList.add(\'active\'); } catch(e) { console.error("Error in startAudio:", e); } }');

const dom = new JSDOM(html, { runScripts: 'dangerously', url: 'http://localhost' });
const window = dom.window;

// Mock AudioContext
window.AudioContext = class {
  constructor() {
    this.state = 'suspended';
    this.currentTime = 0;
    this.destination = {};
  }
  createGain() {
    return { gain: { setValueAtTime: () => {}, linearRampToValueAtTime: () => {} }, connect: () => {} };
  }
  createBufferSource() {
    return { connect: () => {}, start: () => {}, stop: () => {}, disconnect: () => {} };
  }
  createChannelMerger() {
    return { connect: () => {} };
  }
  createOscillator() {
    return { connect: () => {}, start: () => {}, stop: () => {}, disconnect: () => {}, frequency: { value: 0 }, type: 'sine' };
  }
  resume() {}
};
window.webkitAudioContext = window.AudioContext;

// Mock Audio
window.Audio = class {
  constructor() {
    this.volume = 1;
    this.loop = false;
  }
  play() { return Promise.resolve(); }
  pause() {}
};

// Mock localStorage
window.localStorage = {
  getItem: () => null,
  setItem: () => {},
  removeItem: () => {}
};

// Mock Worker
window.Worker = class {
  constructor() {}
  postMessage() {}
  addEventListener() {}
};
window.URL.createObjectURL = () => 'mock-url';

try {
  dom.window.eval(js);
  console.log('JS loaded successfully');

  // Trigger DOMContentLoaded
  const event = window.document.createEvent('Event');
  event.initEvent('DOMContentLoaded', true, true);
  window.document.dispatchEvent(event);
  
  const btnAudioToggle = window.document.getElementById('btn-audio-toggle');
  if (btnAudioToggle) {
    btnAudioToggle.click();
    console.log('Button classes:', btnAudioToggle.className);
  }

} catch(e) {
  console.error('Fatal Error:', e);
}
