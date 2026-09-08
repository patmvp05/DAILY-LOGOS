import React, { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import "@fontsource-variable/inter";
import App from './App.tsx';
import './index.css';
import { AppContextProvider } from './state/AppContext';
import { UiContextProvider } from './state/UiContext';
import { registerSW } from 'virtual:pwa-register';
import { logDiagnostic, getDeviceInfo } from './lib/diagnostics';
import { setPendingUpdate } from './lib/appUpdate';
import { ErrorBoundary } from './components/ErrorBoundary';
import { armChunkRecoveryReset, attemptChunkReload } from './lib/chunkRecovery';

logDiagnostic('lifecycle', 'info', 'App boot', getDeviceInfo());

window.addEventListener('error', (e) => {
  logDiagnostic('window-error', 'error', e.message, { filename: e.filename, lineno: e.lineno });
});
window.addEventListener('unhandledrejection', (e) => {
  logDiagnostic('unhandled-rejection', 'error', String(e.reason?.message || e.reason), e.reason);
});

// Vite fires this when a dynamic import's preload fails — which after a deploy
// means this tab is asking for chunk hashes that no longer exist on Hosting.
// Catching it here recovers before React ever sees a render error; the
// ErrorBoundary is the backstop for the cases that get past it. Both share one
// once-per-session reload guard, so they cannot loop against each other.
window.addEventListener('vite:preloadError', () => {
  // Deliberately NOT preventDefault(): that tells Vite to carry on, so the
  // import resolves undefined and the failure surfaces later as an unrelated
  // "Cannot read properties of undefined" — unrecognisable as a stale chunk, and
  // so neither self-healed nor explained. Letting it reject keeps the real
  // "Failed to fetch dynamically imported module" for the boundary to act on.
  const reloading = attemptChunkReload();
  logDiagnostic('chunk', 'warn', reloading
    ? 'Preload failed; reloading for the current build'
    : 'Preload failed again; already reloaded once this session');
});

// Register the service worker.
//
// iOS keeps tabs and Home Screen apps suspended for days without a real page
// load, which is the only time browsers check for a new service worker - so we
// also check whenever the app returns to the foreground, and hourly.
//
// The mode is 'prompt' (see vite.config.ts), NOT 'autoUpdate'. autoUpdate's
// generated code hard-reloads the page the instant a new worker activates, with
// no hook to intercept - so the foreground update check below would reload the
// app a second or two after launch, right as you were tapping into a chapter.
// In 'prompt' mode the new worker parks in `waiting` and onNeedRefresh hands us
// the function that activates it, which we hold until it costs nothing. Nothing
// is actually prompted; the deferral is invisible.
const updateSW = registerSW({
  immediate: true,
  onRegisteredSW(_swUrl, registration) {
    logDiagnostic('service-worker', 'info', 'Registered');
    if (!registration) return;
    const checkForUpdate = () => registration.update().catch(() => {});
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') checkForUpdate();
    });
    setInterval(checkForUpdate, 60 * 60 * 1000);
  },
  onRegisterError(error) {
    logDiagnostic('service-worker', 'error', 'Registration failed', error);
  },
  onNeedRefresh() {
    // Was dead code under autoUpdate - that mode never calls this. Now it is the
    // handoff: park the update and let useDeferredAppUpdate pick its moment.
    logDiagnostic('service-worker', 'info', 'Update downloaded - deferred until idle');
    setPendingUpdate(() => { void updateSW(); });
  },
  onOfflineReady() {
    logDiagnostic('service-worker', 'info', 'Offline ready');
  }
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary label="App">
      <AppContextProvider>
        <UiContextProvider>
          <App />
        </UiContextProvider>
      </AppContextProvider>
    </ErrorBoundary>
  </StrictMode>
);

// The app rendered. Re-arm the one-shot chunk reload so a tab left open across
// several deploys can heal more than once — a reload loop would have recurred
// long before this fires.
armChunkRecoveryReset();

if ('storage' in navigator && 'persist' in navigator.storage) {
  navigator.storage.persist().catch(() => {});
}
