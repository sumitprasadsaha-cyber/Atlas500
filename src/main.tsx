
import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import './index.css';
import { registerSW } from 'virtual:pwa-register';

// Register Service Worker immediately for offline capability and background cache updates
registerSW({
  immediate: true,
  onNeedRefresh() {
    console.log('[PWA] New version available, updated in background');
  },
  onOfflineReady() {
    console.log('[PWA] Application ready to work offline');
  },
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

