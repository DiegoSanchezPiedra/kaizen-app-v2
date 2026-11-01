import { useQuery } from '@tanstack/react-query'
import { ApiError, api } from '@/lib/api'
import { queryClient } from '@/lib/logout'
import { path } from '@/lib/url'
import { getSession } from '@/lib/session'
import type { AuthMe } from '@/lib/admin'
import type { Booking, Discipline, Insurance, Plan, ProfileStatus, Progress, Subscription } from '@/lib/types'

// GET /bookings también devuelve las que el alumno hizo por sus hijos: cada pantalla enseña solo las del sujeto.
export const bookingsOf = (profileId: string | undefined, from: string, to: string): Promise<Booking[]> =>
  api<{ bookings: Booking[] }>(path('/bookings', { profile_id: profileId, from, to })).then((r) =>
    r.bookings.filter((b) => b.student_id === (profileId ?? getSession()?.id)),
  )

const who = (profileId?: string) => profileId ?? 'self'

export const useProfileStatus = (profileId?: string) =>
  useQuery({
    queryKey: ['profile-status', who(profileId)],
    queryFn: () => api<ProfileStatus>(path('/me/profile-status', { profile_id: profileId })),
  })

export const useBookings = (profileId: string | undefined, from: string, to: string) =>
  useQuery({
    queryKey: ['bookings', who(profileId), from, to],
    queryFn: () => bookingsOf(profileId, from, to),
  })

// Sin suscripción es un 404 esperado: llega como null, no como error.
export const useSubscription = (profileId?: string) =>
  useQuery({
    queryKey: ['subscription', who(profileId)],
    queryFn: () =>
      api<Subscription>(path('/billing/subscription', { profile_id: profileId })).catch((err) => {
        if (err instanceof ApiError && err.code === 'subscription_not_found') return null
        throw err
      }),
  })

// Sin seguro es un 404 esperado, como la suscripción.
export const useInsurance = (profileId?: string) =>
  useQuery({
    queryKey: ['insurance', who(profileId)],
    queryFn: () =>
      api<Insurance>(path('/billing/insurance', { profile_id: profileId })).catch((err) => {
        if (err instanceof ApiError && err.code === 'insurance_not_found') return null
        throw err
      }),
  })

export const usePlans = () => useQuery({ queryKey: ['plans'], queryFn: () => api<{ plans: Plan[] }>('/plans').then((r) => r.plans) })
export const useDisciplines = () =>
  useQuery({ queryKey: ['disciplines'], queryFn: () => api<{ disciplines: Discipline[] }>('/disciplines').then((r) => r.disciplines) })

// Tras un cambio en la cuota: la suscripción, el seguro y el estado (cobertura de riesgo) de Inicio.
export const refreshBilling = () =>
  Promise.all(['subscription', 'insurance', 'profile-status'].map((k) => queryClient.invalidateQueries({ queryKey: [k] })))

export const useProgress = (profileId: string | undefined, month?: string) =>
  useQuery({
    queryKey: ['progress', who(profileId), month ?? 'now'],
    queryFn: () => api<Progress>(path('/me/progress', { profile_id: profileId, month })),
  })

// Tras reservar o cancelar cambia el calendario, las reservas y el estado de Inicio.
export const refreshBookings = () => Promise.all(['calendar', 'bookings'].map((k) => queryClient.invalidateQueries({ queryKey: [k] })))

export { path }

// GET /auth/me: el panel lo lee para el aviso del MFA (ADR 0016).
export const useAuthMe = () => useQuery({ queryKey: ['auth-me'], queryFn: () => api<AuthMe>('/auth/me') })
