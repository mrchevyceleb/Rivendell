import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './tokens.css';
import './index.css';
import './chat/chat-theme.css';
import App from './App';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch((err) => {
      console.warn('[rivendell] service worker registration failed', err);
    });
  });
}
