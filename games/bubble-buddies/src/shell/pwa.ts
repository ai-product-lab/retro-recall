/**
 * PWA glue (ADR-007): service-worker registration plus the install flow.
 * iOS has no install prompt, so "install" there is a friendly pin-me screen
 * walking through Safari's share sheet → Add to Home Screen. Browsers with
 * beforeinstallprompt (Android/desktop Chrome) get the real prompt instead.
 */
import { isIOS, isStandalone } from './device';
import { isInAppBrowser } from './invite';

export function registerServiceWorker(): void {
  // Dev server: never cache vite's module graph.
  if (import.meta.env.DEV) return;
  if ('serviceWorker' in navigator) {
    void navigator.serviceWorker.register('/sw.js').catch(() => {
      // Offline shell is a nicety — the game must not care if it fails.
    });
  }
}

/** Chrome-family deferred install prompt, captured if the browser offers it. */
interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
}
let deferredPrompt: BeforeInstallPromptEvent | null = null;
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferredPrompt = e as BeforeInstallPromptEvent;
});

const SHARE_ICON_SVG =
  '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-3px">' +
  '<path d="M12 3v12" /><path d="M8 7l4-4 4 4" /><path d="M5 11v8a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-8" /></svg>';

function showPinMeScreen(): void {
  const overlay = document.createElement('div');
  overlay.className = 'pinme-overlay';
  overlay.innerHTML = `
    <div class="overlay-card">
      <div class="pinme-bubble">📌</div>
      <h2>Pin Bubble Buddies</h2>
      <p>Put it on your home screen — it opens full-screen, like a real app.</p>
      <ol class="pinme-steps">
        <li>Tap the <b>Share</b> button ${SHARE_ICON_SVG} at the bottom of Safari</li>
        <li>Scroll down and tap <b>Add to Home Screen</b></li>
        <li>Tap <b>Add</b> — that's it!</li>
      </ol>
      <button class="chip-btn primary pinme-close">GOT IT</button>
    </div>`;
  overlay.querySelector('.pinme-close')?.addEventListener('click', () => {
    localStorage.setItem('bb-pin-seen', '1');
    overlay.remove();
  });
  document.body.append(overlay);
}

/**
 * Wire an install affordance into `slot` when installing makes sense here:
 * a "📌 pin me" link on iOS Safari, the native prompt elsewhere. No-op when
 * already installed or inside an in-app browser (which can't install).
 */
export function offerInstall(slot: HTMLElement, autoShowOnIOS = false): void {
  if (isStandalone() || isInAppBrowser()) return;
  const ios = isIOS();
  if (!ios && deferredPrompt === null) {
    // Give Chrome a beat to fire beforeinstallprompt, then check once more.
    setTimeout(() => {
      if (deferredPrompt !== null) offerInstall(slot, autoShowOnIOS);
    }, 2500);
    return;
  }
  const btn = document.createElement('button');
  btn.className = 'chip-btn pin-hint';
  btn.textContent = '📌 pin me';
  btn.addEventListener('click', () => {
    if (ios) showPinMeScreen();
    else void deferredPrompt?.prompt();
  });
  slot.append(btn);
  // First visit on iOS (home page only): open the walkthrough once, unprompted.
  if (autoShowOnIOS && ios && localStorage.getItem('bb-pin-seen') === null) showPinMeScreen();
}
