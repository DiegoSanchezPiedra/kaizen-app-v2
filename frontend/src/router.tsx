import { useEffect } from 'react'
import { createBrowserRouter, Navigate, Outlet, useLocation, useSearchParams } from 'react-router'
import { setUnauthorizedHandler, setWrongRoleHandler } from '@/lib/api'
import { checkRole, logout } from '@/lib/logout'
import { loginPath, redirectFor, safeReturnPath } from '@/lib/paths'
import { getEndReason, isExpired, useSession } from '@/lib/session'
import { AccountPage, AgreementsPage, DataPage, HealthPage } from '@/pages/account'
import { PublicProfilePage } from '@/pages/account-profile'
import { BillingPage, DisciplinePage, InsurancePage, PlanPage } from '@/pages/billing'
import { CancelPage, ContractPage, PayerChangePage, SuccessPage } from '@/pages/billing-contract'
import { BookingsPage } from '@/pages/bookings'
import { CalendarPage } from '@/pages/calendar'
import { ChildFormPage, ChildrenPage } from '@/pages/children'
import { CommunityPage, ProfilePage, RankingsPage } from '@/pages/community'
import { HomePage } from '@/pages/home'
import { OnboardingPage } from '@/pages/onboarding'
import { ProfessorSessionPage, ProfessorSessionsPage } from '@/pages/professor'
import { ProfessorReportsPage } from '@/pages/professor-reports'
import { ProgressPage } from '@/pages/progress'
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

// Con sesión: cada rol a lo suyo (el admin, al panel). Al abrir, el rol de GET /me tiene que ser el del token.
function RequireSession() {
  const session = useSession()
  const location = useLocation()
  const expired = session ? isExpired(session) : false
  const token = expired ? null : session?.token

  useEffect(() => {
    if (expired) logout({ expired: true })
  }, [expired])

  useEffect(() => {
    if (token) void checkRole()
  }, [token])

  if (!session) return <Navigate to={loginPath(getEndReason(), location.pathname + location.search)} replace />
  if (expired) return null
  const to = redirectFor(session.role, location.pathname)
  if (to) return <Navigate to={to} replace />
  return session.role === 'admin' ? <Outlet /> : <AppShell />
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
  // La tablet no es un usuario: sin sesión, con su propio token. Pesa por `qrcode`, así que se baja solo aquí.
  { path: '/tablet', lazy: async () => ({ Component: (await import('@/pages/tablet')).TabletPage }) },
  {
    element: <RequireSession />,
    children: [
      // El panel va en trozos aparte que el alumno no baja (el Service Worker los precachea con el esqueleto).
      {
        path: '/admin',
        lazy: async () => ({ Component: (await import('@/pages/admin/shell')).AdminShell }),
        children: [
          { index: true, lazy: async () => ({ Component: (await import('@/pages/admin/home')).AdminHomePage }) },
          { path: 'mfa', lazy: async () => ({ Component: (await import('@/pages/admin/mfa')).MfaSetupPage }) },
          { path: 'account', lazy: async () => ({ Component: (await import('@/pages/admin/account')).AdminAccountPage }) },
          { path: 'users', lazy: async () => ({ Component: (await import('@/pages/admin/users')).UsersPage }) },
          { path: 'users/:id', lazy: async () => ({ Component: (await import('@/pages/admin/users')).UserPage }) },
          { path: 'sessions', lazy: async () => ({ Component: (await import('@/pages/admin/sessions')).AdminSessionsPage }) },
          { path: 'sessions/:id', lazy: async () => ({ Component: (await import('@/pages/admin/sessions')).AdminSessionPage }) },
          { path: 'classes', lazy: async () => ({ Component: (await import('@/pages/admin/classes')).AdminClassesPage }) },
          { path: 'billing', lazy: async () => ({ Component: (await import('@/pages/admin/billing')).AdminBillingPage }) },
          { path: 'notices', lazy: async () => ({ Component: (await import('@/pages/admin/notices')).AdminNoticesPage }) },
          { path: 'audit', lazy: async () => ({ Component: (await import('@/pages/admin/audit')).AdminAuditPage }) },
          { path: 'reports', lazy: async () => ({ Component: (await import('@/pages/admin/reports')).AdminReportsPage }) },
          { path: '*', lazy: async () => ({ Component: (await import('@/pages/admin/shell')).AdminPending }) },
        ],
      },
      { path: '/', element: <HomePage /> },
      { path: '/onboarding', element: <OnboardingPage /> },
      { path: '/calendar', element: <CalendarPage /> },
      { path: '/bookings', element: <BookingsPage /> },
      // El lector de QR solo se baja al abrir el check-in.
      { path: '/checkin', lazy: async () => ({ Component: (await import('@/pages/checkin')).CheckinPage }) },
      { path: '/professor', element: <ProfessorSessionsPage /> },
      { path: '/professor/sessions/:id', element: <ProfessorSessionPage /> },
      { path: '/professor/reports', element: <ProfessorReportsPage /> },
      { path: '/progress', element: <ProgressPage /> },
      { path: '/profiles', element: <CommunityPage /> },
      { path: '/profiles/:id', element: <ProfilePage /> },
      { path: '/rankings', element: <RankingsPage /> },
      { path: '/rankings/:id', element: <RankingsPage /> },
      { path: '/account', element: <AccountPage /> },
      { path: '/account/data', element: <DataPage /> },
      { path: '/account/profile', element: <PublicProfilePage /> },
      { path: '/account/children', element: <ChildrenPage /> },
      { path: '/account/children/new', element: <ChildFormPage /> },
      { path: '/account/children/:id', element: <ChildFormPage /> },
      { path: '/account/health', element: <HealthPage /> },
      { path: '/agreements', element: <AgreementsPage /> },
      { path: '/billing', element: <BillingPage /> },
      { path: '/billing/contract', element: <ContractPage /> },
      { path: '/billing/plan', element: <PlanPage /> },
      { path: '/billing/discipline', element: <DisciplinePage /> },
      { path: '/billing/insurance', element: <InsurancePage /> },
      { path: '/billing/success', element: <SuccessPage /> },
      { path: '/billing/cancel', element: <CancelPage /> },
      { path: '/billing/payer-changes/:id', element: <PayerChangePage /> },
      { path: '*', element: <PendingScreen /> },
    ],
  },
])

setUnauthorizedHandler(() => void logout({ expired: true }))
setWrongRoleHandler(() => void checkRole())
