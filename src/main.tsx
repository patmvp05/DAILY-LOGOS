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
registerSW({ immediate: true });

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
