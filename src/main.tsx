import React, { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import "@fontsource-variable/inter";
import App from './App.tsx';
import './index.css';
import { AppContextProvider } from './state/AppContext';
import { UiContextProvider } from './state/UiContext';
import { registerSW } from 'virtual:pwa-register';

// Register service worker. immediate:true + autoUpdate means new deploys
// activate on the next visit instead of waiting for a prompt that never shows.
// iOS keeps tabs and Home Screen apps suspended for days without a real page
// load, which is the only time browsers check for a new service worker - so we
// also check whenever the app returns to the foreground, and hourly.
registerSW({
  immediate: true,
  onRegisteredSW(_swUrl, registration) {
    if (!registration) return;
    const checkForUpdate = () => registration.update().catch(() => {});
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') checkForUpdate();
    });
    setInterval(checkForUpdate, 60 * 60 * 1000);
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
