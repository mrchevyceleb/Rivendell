import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Studio } from './shell/Studio';
import { ProxyViewerProvider } from './components/ProxyViewer';
import { JarvisProvider } from './jarvis/JarvisProvider';
import { JarvisOverlay } from './jarvis/JarvisOverlay';

const queryClient = new QueryClient();

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <ProxyViewerProvider>
        <JarvisProvider>
          <Studio />
          <JarvisOverlay />
        </JarvisProvider>
      </ProxyViewerProvider>
    </QueryClientProvider>
  );
}
