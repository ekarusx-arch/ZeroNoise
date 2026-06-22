(() => {
  const mobileQuery = window.matchMedia('(max-width: 900px)');
  const standaloneQuery = window.matchMedia('(display-mode: standalone)');
  const validViews = new Set(['focus', 'sound', 'write', 'stats']);
  const installButton = document.getElementById('pwa-install-button');
  const installGuide = document.getElementById('pwa-install-guide');
  const installGuideClose = document.getElementById('pwa-install-guide-close');
  const offlineIndicator = document.getElementById('offline-indicator');
  const zenEditor = document.getElementById('zen-editor');
  const mobileNavItems = Array.from(document.querySelectorAll('[data-mobile-view]'));
  const isIos = /iphone|ipad|ipod/i.test(window.navigator.userAgent);
  let deferredInstallPrompt = null;

  function isStandalone() {
    return standaloneQuery.matches || window.navigator.standalone === true;
  }

  function readSavedView() {
    const queryView = new URLSearchParams(window.location.search).get('view');
    if (validViews.has(queryView)) return queryView;

    try {
      const savedView = window.sessionStorage.getItem('zeronoise_mobile_view');
      return validViews.has(savedView) ? savedView : 'focus';
    } catch {
      return 'focus';
    }
  }

  function expandCurrentPanel(view) {
    const selector = view === 'focus' ? '.timer-card' : view === 'sound' ? '.sound-card' : null;
    if (!selector) return;

    document.querySelector(selector)?.classList.remove('collapsed');
  }

  function setMobileView(view, options = {}) {
    if (!validViews.has(view)) return;

    document.body.dataset.mobileView = view;
    mobileNavItems.forEach((item) => {
      const isActive = item.dataset.mobileView === view;
      item.classList.toggle('active', isActive);
      item.setAttribute('aria-current', isActive ? 'page' : 'false');
    });
    expandCurrentPanel(view);

    if (options.persist !== false) {
      try {
        window.sessionStorage.setItem('zeronoise_mobile_view', view);
      } catch {
        // The view still works when private storage is unavailable.
      }
    }

    if (mobileQuery.matches && options.scroll !== false) {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  }

  function syncStandaloneState() {
    document.documentElement.classList.toggle('is-standalone', isStandalone());
    if (isStandalone()) installButton.hidden = true;
  }

  function updateInstallButton() {
    const canShow = !isStandalone() && (Boolean(deferredInstallPrompt) || isIos);
    installButton.hidden = !canShow;
  }

  function closeInstallGuide() {
    installGuide.hidden = true;
    installButton.focus();
  }

  function updateOnlineState() {
    offlineIndicator.hidden = window.navigator.onLine;
    document.documentElement.classList.toggle('is-offline', !window.navigator.onLine);
  }

  function shouldWarmAudioCache() {
    if (!isStandalone() || !window.navigator.onLine) return false;
    const connection = window.navigator.connection;
    return !connection?.saveData && connection?.effectiveType !== '2g';
  }

  async function registerServiceWorker() {
    if (!('serviceWorker' in window.navigator)) return;

    try {
      const registration = await window.navigator.serviceWorker.register('./sw.js');
      await registration.update();

      if (registration.waiting) {
        registration.waiting.postMessage({ type: 'SKIP_WAITING' });
      }

      const readyRegistration = await window.navigator.serviceWorker.ready;
      if (shouldWarmAudioCache()) {
        readyRegistration.active?.postMessage({ type: 'CACHE_AUDIO' });
      }
    } catch (error) {
      console.warn('ZeroNoise service worker registration failed:', error);
    }
  }

  mobileNavItems.forEach((item) => {
    item.addEventListener('click', () => setMobileView(item.dataset.mobileView));
  });

  document.getElementById('btn-goto-stats')?.addEventListener('click', () => {
    setMobileView('stats');
  });

  document.getElementById('btn-goto-main')?.addEventListener('click', () => {
    setMobileView('focus');
  });

  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault();
    deferredInstallPrompt = event;
    updateInstallButton();
  });

  window.addEventListener('appinstalled', () => {
    deferredInstallPrompt = null;
    installButton.hidden = true;
    syncStandaloneState();
  });

  installButton.addEventListener('click', async () => {
    if (deferredInstallPrompt) {
      deferredInstallPrompt.prompt();
      await deferredInstallPrompt.userChoice;
      deferredInstallPrompt = null;
      updateInstallButton();
      return;
    }

    if (isIos) {
      installGuide.hidden = false;
      installGuideClose.focus();
    }
  });

  installGuideClose.addEventListener('click', closeInstallGuide);
  installGuide.addEventListener('click', (event) => {
    if (event.target === installGuide) closeInstallGuide();
  });

  document.addEventListener('focusin', (event) => {
    if (event.target === zenEditor) {
      document.body.classList.add('editor-keyboard-active');
    }
  });
  document.addEventListener('focusout', (event) => {
    if (event.target === zenEditor) {
      document.body.classList.remove('editor-keyboard-active');
    }
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !installGuide.hidden) closeInstallGuide();
  });

  window.addEventListener('online', updateOnlineState);
  window.addEventListener('offline', updateOnlineState);
  standaloneQuery.addEventListener?.('change', syncStandaloneState);

  setMobileView(readSavedView(), { persist: false, scroll: false });
  syncStandaloneState();
  updateInstallButton();
  updateOnlineState();
  registerServiceWorker();
})();
