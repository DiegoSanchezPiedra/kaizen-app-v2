import { QueryClientProvider } from '@tanstack/react-query'
import type React from 'react'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { RouterProvider } from 'react-router'
import { registerSW } from 'virtual:pwa-register'
import './index.css'
import { Spinner } from '@/components/ui/spinner'
import { ToastProvider, toastManager } from '@/components/ui/toast'
import { queryClient } from '@/lib/logout'
import { router } from '@/router'
import { reportError } from '@/lib/report'
import { updateAndReload, watchForUpdates } from '@/lib/sw-update'
import { applyTheme, systemDark } from '@/lib/theme'

applyTheme() // lib/theme: preferencia del dispositivo o la del sistema; la tablet siempre oscura
systemDark().addEventListener('change', applyTheme)

// Lo que revienta fuera de React (el arranque, una promesa suelta) también deja rastro (lib/report.ts).
window.addEventListener('error', (e) => e.error && reportError(e.error, { where: 'window' }))
window.addEventListener('unhandledrejection', (e) => reportError(e.reason, { where: 'promise' }))

// ADR 0015: una versión nueva espera al «Actualizar» (también en /tablet, lo toca el profesor); nunca se activa sola.
// El aviso sale en cuanto se detecta («Descargando…») y no al acabar de bajarla, que en el iPhone tarda; un solo aviso,
// que vuelve si se cierra con la versión aún esperando (watchForUpdates).
let updateToast: string | undefined
const busy = (children: React.ReactNode) => ({ children: <><Spinner />{children}</>, disabled: true, 'aria-busy': true })
function showUpdate(ready: boolean) {
  const toast = {
    type: 'info',
    title: ready ? 'Hay una versión nueva' : 'Descargando una versión nueva…',
    description: ready ? 'Actualiza para seguir con la última.' : 'En unos segundos podrás actualizar.',
    actionProps: ready
      ? {
          children: 'Actualizar',
          onClick: () => {
            if (updateToast) toastManager.update(updateToast, { actionProps: busy('Actualizando…') })
            void updateAndReload()
          },
        }
      : busy('Descargando'),
  }
  if (updateToast) return toastManager.update(updateToast, toast)
  updateToast = toastManager.add({ ...toast, timeout: 0, onRemove: () => void (updateToast = undefined) })
}

registerSW({
  onRegisteredSW: (_url, reg) => {
    if (!reg) return
    // Sin controlador es la primera instalación, no una versión nueva.
    reg.addEventListener('updatefound', () => navigator.serviceWorker.controller && showUpdate(false))
    watchForUpdates(reg, () => showUpdate(true))
  },
  onNeedRefresh: () => showUpdate(true),
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
