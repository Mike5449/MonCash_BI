import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { Provider } from './components/ui/provider'
import { OpenAPI } from './api/core/OpenAPI'
import './index.css'
import App from './App.tsx'

OpenAPI.BASE = import.meta.env.VITE_API_BASE_URL || 'http://localhost:8000'

// Cache API responses in the browser. Databricks data refreshes ~once a day,
// so a 10-minute staleTime makes navigating between pages instant while staying
// fresh enough. Aligns with the backend's 10-minute server-side cache.
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 10 * 60 * 1000,   // 10 min — data considered fresh, no refetch
      gcTime: 30 * 60 * 1000,      // keep unused data in cache for 30 min
      refetchOnWindowFocus: false, // don't refire heavy queries on tab focus
      refetchOnReconnect: false,
      retry: 1,
    },
  },
})

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <Provider>
        <App />
      </Provider>
    </QueryClientProvider>
  </StrictMode>,
)
