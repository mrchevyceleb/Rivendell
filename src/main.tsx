import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './tokens.css';
import './index.css';
import './chat/chat-theme.css';
import './chat/chat-reimagine.css';
import './grok/grok.css';
import App from './App';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

// Rivendell ships no service worker. The old PWA-only one registered a no-op
// `fetch` handler, which browsers flag as dead weight on every navigation, and
// it bought nothing: it cached neither the shell nor any API response. Retire
// whatever is still installed on clients that picked it up.
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    void navigator.serviceWorker
      .getRegistrations()
      .then((regs) => Promise.all(regs.map((r) => r.unregister())))
      .catch(() => { /* best effort - nothing to retire */ });
  });
}
