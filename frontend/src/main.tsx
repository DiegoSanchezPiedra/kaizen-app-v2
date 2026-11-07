import { QueryClientProvider } from '@tanstack/react-query'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { RouterProvider } from 'react-router'
import { registerSW } from 'virtual:pwa-register'
import './index.css'
import { Spinner } from '@/components/ui/spinner'
import { ToastProvider, toastManager } from '@/components/ui/toast'
import { queryClient } from '@/lib/logout'
import { router } from '@/router'
import { watchForUpdates } from '@/lib/sw-update'
import { applyTheme, systemDark } from '@/lib/theme'

applyTheme() // lib/theme: preferencia del dispositivo o la del sistema; la tablet siempre oscura
systemDark().addEventListener('change', applyTheme)

// ADR 0015: una versión nueva espera al «Actualizar» (también en /tablet, lo toca el profesor); nunca se activa sola.
const updateSW = registerSW({
  onRegisteredSW: (_url, reg) => reg && watchForUpdates(reg),
  onNeedRefresh() {
    const id = toastManager.add({
      type: 'info',
      title: 'Hay una versión nueva',
      timeout: 0,
      actionProps: {
        children: 'Actualizar',
        onClick: () => {
          toastManager.update(id, {
            actionProps: { children: <><Spinner />Actualizando…</>, disabled: true, 'aria-busy': true },
          })
          void updateSW(true)
        },
      },
    })
  },
})

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
