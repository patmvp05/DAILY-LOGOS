import React, { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import "@fontsource-variable/inter";
import App from './App.tsx';
import './index.css';
import { AppContextProvider } from './state/AppContext';
import { UiContextProvider } from './state/UiContext';
import { registerSW } from 'virtual:pwa-register';
import { logDiagnostic, getDeviceInfo } from './lib/diagnostics';

logDiagnostic('lifecycle', 'info', 'App boot', getDeviceInfo());

window.addEventListener('error', (e) => {
  logDiagnostic('window-error', 'error', e.message, { filename: e.filename, lineno: e.lineno });
});
window.addEventListener('unhandledrejection', (e) => {
  logDiagnostic('unhandled-rejection', 'error', String(e.reason?.message || e.reason), e.reason);
});

// Register service worker. immediate:true + autoUpdate means new deploys
// activate on the next visit instead of waiting for a prompt that never shows.
// iOS keeps tabs and Home Screen apps suspended for days without a real page
// load, which is the only time browsers check for a new service worker - so we
// also check whenever the app returns to the foreground, and hourly.
registerSW({
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
    logDiagnostic('service-worker', 'info', 'New version activated');
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
