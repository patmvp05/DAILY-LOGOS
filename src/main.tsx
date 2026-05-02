import React, { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import "@fontsource-variable/inter";
import App from './App.tsx';
import './index.css';
import { AppContextProvider } from './state/AppContext';
import { UiContextProvider } from './state/UiContext';

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
