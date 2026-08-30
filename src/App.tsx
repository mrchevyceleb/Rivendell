import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Studio } from './shell/Studio';
import { GrokApp } from './grok/GrokApp';
import { ProxyViewerProvider } from './components/ProxyViewer';
import { JarvisProvider } from './jarvis/JarvisProvider';
import { JarvisOverlay } from './jarvis/JarvisOverlay';

const queryClient = new QueryClient();

// The Grok rebuild is the default shell. The classic Studio IDE stays one
// click away at /studio (and owns the ?path= deep link). Legacy room URLs
// (/council, /pins, …) land in the Grok shell with that room open.
const studioMatch = /^\/studio(\/|$)/.test(window.location.pathname);
const legacyRoom = window.location.pathname.replace(/^\/+/, '').replace(/\/+$/, '');

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <ProxyViewerProvider>
        <JarvisProvider>
          {studioMatch ? <Studio /> : <GrokApp initialRoom={legacyRoom || undefined} />}
          <JarvisOverlay />
        </JarvisProvider>
      </ProxyViewerProvider>
    </QueryClientProvider>
  );
}
