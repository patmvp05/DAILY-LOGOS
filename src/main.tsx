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

logDiagnostic('lifecycle', 'info', 'App boot', getDeviceInfo());

window.addEventListener('error', (e) => {
  logDiagnostic('window-error', 'error', e.message, { filename: e.filename, lineno: e.lineno });
});
window.addEventListener('unhandledrejection', (e) => {
  logDiagnostic('unhandled-rejection', 'error', String(e.reason?.message || e.reason), e.reason);
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
    <AppContextProvider>
      <UiContextProvider>
        <App />
      </UiContextProvider>
    </AppContextProvider>
  </StrictMode>
);

if ('storage' in navigator && 'persist' in navigator.storage) {
  navigator.storage.persist().catch(() => {});
}
