import { QueryClientProvider } from '@tanstack/react-query'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { RouterProvider } from 'react-router'
import './index.css'
import { ToastProvider } from '@/components/ui/toast'
import { queryClient } from '@/lib/logout'
import { router } from '@/router'

// El modo oscuro sigue la preferencia del sistema (fijarlo en Cuenta queda para B18.2); la tablet siempre es oscura.
const dark = window.matchMedia('(prefers-color-scheme: dark)')
const applyTheme = () => document.documentElement.classList.toggle('dark', dark.matches || location.pathname === '/tablet')
applyTheme()
dark.addEventListener('change', applyTheme)

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <div className="relative isolate flex min-h-dvh flex-col">
        <ToastProvider position="top-center">
          <RouterProvider router={router} />
        </ToastProvider>
      </div>
    </QueryClientProvider>
  </StrictMode>,
)
