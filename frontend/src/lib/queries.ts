import { useQuery } from '@tanstack/react-query'
import { ApiError, api } from '@/lib/api'
import { queryClient } from '@/lib/logout'
import { path } from '@/lib/url'
import { getSession } from '@/lib/session'
import type { AuthMe } from '@/lib/admin'
import type { ClockMonth } from '@/lib/clock'
import type { EventInfo } from '@/lib/events'
import type { Booking, Discipline, Plan, ProfileStatus, Progress, Subscription } from '@/lib/types'

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

export const usePlans = () => useQuery({ queryKey: ['plans'], queryFn: () => api<{ plans: Plan[] }>('/plans').then((r) => r.plans) })
export const useDisciplines = () =>
  useQuery({ queryKey: ['disciplines'], queryFn: () => api<{ disciplines: Discipline[] }>('/disciplines').then((r) => r.disciplines) })

// Tras un cambio en la cuota: la suscripción y el estado del perfil de Inicio.
export const refreshBilling = () =>
  Promise.all(['subscription', 'profile-status'].map((k) => queryClient.invalidateQueries({ queryKey: [k] })))

export const useProgress = (profileId: string | undefined, month?: string) =>
  useQuery({
    queryKey: ['progress', who(profileId), month ?? 'now'],
    queryFn: () => api<Progress>(path('/me/progress', { profile_id: profileId, month })),
  })

// Quien mira ya celebró las medallas de ese perfil; recarga su progreso (Inicio y Progreso).
export const markMedalsSeen = (profileId: string | undefined, codes: string[]) =>
  api('/me/progress/seen', { method: 'POST', body: { profile_id: profileId, codes } })
    .then(() => queryClient.invalidateQueries({ queryKey: ['progress', who(profileId)] }))

// Tras reservar o cancelar cambia el calendario, las reservas y el estado de Inicio.
export const refreshBookings = () => Promise.all(['calendar', 'bookings'].map((k) => queryClient.invalidateQueries({ queryKey: [k] })))

export { path }

// GET /auth/me: el panel lo lee para el aviso del MFA (ADR 0016).
export const useAuthMe = () => useQuery({ queryKey: ['auth-me'], queryFn: () => api<AuthMe>('/auth/me') })

// Eventos (B21.2). `registered`: solo aquellos en los que el sujeto tiene inscripción (Reservas e Inicio).
const eventsOf = (profileId: string | undefined, registered: boolean) =>
  api<{ events: EventInfo[] }>(path('/events', { profile_id: profileId, registered: registered ? 'true' : undefined })).then((r) => r.events)
export const useEvents = (profileId: string | undefined, registered = false) =>
  useQuery({ queryKey: ['events', who(profileId), registered ? 'mine' : 'all'], queryFn: () => eventsOf(profileId, registered) })
export const eventOf = (id: string, profileId: string | undefined) =>
  api<{ event: EventInfo }>(path(`/events/${id}`, { profile_id: profileId })).then((r) => r.event)
export const useEvent = (id: string, profileId: string | undefined) =>
  useQuery({ queryKey: ['events', who(profileId), 'one', id], queryFn: () => eventOf(id, profileId) })
// Tras inscribirse o cancelar cambian la lista, el detalle, Reservas e Inicio.
export const refreshEvents = () => queryClient.invalidateQueries({ queryKey: ['events'] })

// Registro de jornada (B31): el del profesor (['clock', mes]) y el que mira el admin (['admin', 'clock', perfil, mes]).
export const useClock = (month: string) => useQuery({ queryKey: ['clock', month], queryFn: () => api<ClockMonth>(path('/me/clock', { month })) })
export const useAdminClock = (profileId: string, month: string) =>
  useQuery({ queryKey: ['admin', 'clock', profileId, month], queryFn: () => api<ClockMonth>(path('/admin/clock', { profile_id: profileId, month })) })
export const useEmployees = () => useQuery({ queryKey: ['admin', 'clock', 'employees'], queryFn: () => api<{ employees: { id: string; display_name: string | null }[] }>('/admin/clock/employees') })
