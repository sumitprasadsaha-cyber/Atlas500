
import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import './index.css';
import { initPwaUpdateService } from './lib/pwaUpdateService';

// Initialize automatic PWA update detection, immediate activation, cache management, and seamless single refresh
initPwaUpdateService();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);


