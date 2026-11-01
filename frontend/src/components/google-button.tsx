import { useEffect, useRef } from 'react'

// Botón de Google Identity Services: lo pinta Google (iframe), aquí solo se elige su aspecto.
// shortcut: sin VITE_GOOGLE_CLIENT_ID no se enseña; en producción tiene que estar configurado.
const CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID as string | undefined
const SRC = 'https://accounts.google.com/gsi/client'
export const googleEnabled = Boolean(CLIENT_ID)

type Gsi = {
  accounts: {
    id: {
      initialize: (o: { client_id: string; callback: (r: { credential: string }) => void; ux_mode?: string }) => void
      renderButton: (el: HTMLElement, o: Record<string, unknown>) => void
    }
  }
}

let loading: Promise<Gsi> | null = null
function loadGsi(): Promise<Gsi> {
  loading ??= new Promise((resolve, reject) => {
    const s = document.createElement('script')
    s.src = SRC
    s.async = true
    s.onload = () => resolve((window as unknown as { google: Gsi }).google)
    s.onerror = () => {
      loading = null
      reject(new Error('gsi'))
    }
    document.head.appendChild(s)
  })
  return loading
}

export function GoogleButton({ onCredential, disabled }: { onCredential: (idToken: string) => void; disabled?: boolean }) {
  const ref = useRef<HTMLDivElement>(null)
  const cb = useRef(onCredential)
  cb.current = onCredential

  useEffect(() => {
    if (!CLIENT_ID || !ref.current) return
    const el = ref.current
    let alive = true
    loadGsi()
      .then((google) => {
        if (!alive) return
        google.accounts.id.initialize({ client_id: CLIENT_ID, callback: (r) => cb.current(r.credential) })
        const dark = document.documentElement.classList.contains('dark')
        google.accounts.id.renderButton(el, {
          theme: dark ? 'filled_black' : 'outline',
          size: 'large',
          shape: 'rectangular',
          text: 'continue_with',
          locale: 'es',
          width: Math.min(el.clientWidth || 400, 400),
        })
      })
      .catch(() => {})
    return () => {
      alive = false
    }
  }, [])

  if (!CLIENT_ID) return null
  return (
    <div
      ref={ref}
      className="flex min-h-10 justify-center aria-disabled:pointer-events-none aria-disabled:opacity-64"
      aria-disabled={disabled || undefined}
    />
  )
}
