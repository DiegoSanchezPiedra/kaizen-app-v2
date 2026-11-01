import { useEffect } from 'react'
import { createBrowserRouter, Navigate, Outlet, useLocation, useSearchParams } from 'react-router'
import { setUnauthorizedHandler } from '@/lib/api'
import { logout } from '@/lib/logout'
import { loginPath, safeReturnPath } from '@/lib/paths'
import { getEndReason, isExpired, useSession } from '@/lib/session'
import { AdminWaitingPage } from '@/pages/admin-waiting'
import { AppShell, PendingScreen } from '@/pages/app-shell'
import { LoginPage } from '@/pages/login'
import { ForgotPasswordPage, ResetPasswordPage } from '@/pages/password'
import { RegisterPage } from '@/pages/register'

// Sin sesión. Al entrar (o si ya la hay) es la única que redirige: a ?volver= o al inicio.
function PublicOnly() {
  const session = useSession()
  const [params] = useSearchParams()
  return session && !isExpired(session) ? <Navigate to={safeReturnPath(params.get('volver'))} replace /> : <Outlet />
}

// Con sesión: cada rol a lo suyo; el admin, a la espera hasta B19.
function RequireSession() {
  const session = useSession()
  const location = useLocation()
  const expired = session ? isExpired(session) : false

  useEffect(() => {
    if (expired) logout({ expired: true })
  }, [expired])

  if (!session) return <Navigate to={loginPath(getEndReason(), location.pathname + location.search)} replace />
  if (expired) return null
  if (session.role === 'admin') return <AdminWaitingPage />
  if (session.role === 'profesor' && location.pathname === '/') return <Navigate to="/professor" replace />
  return <AppShell />
}

export const router = createBrowserRouter([
  {
    element: <PublicOnly />,
    children: [
      { path: '/login', element: <LoginPage /> },
      { path: '/register', element: <RegisterPage /> },
      { path: '/forgot-password', element: <ForgotPasswordPage /> },
    ],
  },
  // Vale con o sin sesión: el enlace llega por email.
  { path: '/reset-password', element: <ResetPasswordPage /> },
  {
    element: <RequireSession />,
    children: [{ path: '*', element: <PendingScreen /> }],
  },
])

setUnauthorizedHandler(() => void logout({ expired: true }))
