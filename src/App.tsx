import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Studio } from './shell/Studio';
import { ProxyViewerProvider } from './components/ProxyViewer';

const queryClient = new QueryClient();

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <ProxyViewerProvider>
        <Studio />
      </ProxyViewerProvider>
    </QueryClientProvider>
  );
}
