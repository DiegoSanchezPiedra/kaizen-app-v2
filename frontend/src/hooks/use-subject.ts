import { useQuery } from '@tanstack/react-query'
import { useEffect } from 'react'
import { useSearchParams } from 'react-router'
import { api } from '@/lib/api'
import { takeCheckoutSubject } from '@/lib/billing'
import { useMeKey } from '@/components/my-data-form'
import { useSession } from '@/lib/session'
import { activeSubject, subjectOptions, type Child } from '@/lib/subject'
import type { Me } from '@/lib/types'

// El sujeto activo vive en ?para= y en la caché en memoria de /me/children; nunca en localStorage.
export function useSubject() {
  const session = useSession()
  const [params, setParams] = useSearchParams()
  const enabled = session?.role === 'alumno' || session?.role === 'tutor'
  const { data, isPending, error, refetch } = useQuery({
    // Misma clave y misma forma (la lista) que pages/children.tsx: si no, la que llega primero a la caché rompe a la otra.
    queryKey: ['me', 'children'],
    queryFn: () => api<{ children: Child[] }>('/me/children').then((r) => r.children),
    enabled,
    staleTime: 30_000, // igual en pages/children.tsx: cada pantalla monta el selector y no debe volver a pedirla
  })
  // La fecha propia (para la edad de las disciplinas) sale de /me: misma clave que my-data-form.
  const me = useQuery({ queryKey: useMeKey, queryFn: () => api<Me>('/me'), enabled: session?.role === 'alumno', staleTime: 30_000 })
  const options = session && data && (session.role !== 'alumno' || me.data) ? subjectOptions(session.role, session.id, me.data?.birth_date ?? null, data) : []
  const subject = activeSubject(options, params.get('para'))
  const select = (id: string) =>
    setParams((p) => {
      p.set('para', id)
      return p
    })
  // Las pestañas y los enlaces conservan el sujeto elegido.
  const para = params.get('para')
  const withSubject = (pathname: string) => ({ pathname, search: para ? `?${new URLSearchParams({ para })}` : '' })
  return {
    options,
    withSubject,
    subject,
    // Para uno mismo no se manda: el calendario solo acepta profile_id de un hijo (o del admin) y responde 403.
    profileId: subject && !subject.self ? subject.id : undefined,
    loading: enabled && (isPending || (session?.role === 'alumno' && me.isPending)),
    error: error ?? me.error,
    retry: () => void Promise.all([refetch(), me.refetch()]),
    select,
  }
}

// La vuelta de Stripe no trae ?para=: se recupera el sujeto que se guardó al ir a pagar.
export function useCheckoutSubject() {
  const [params, setParams] = useSearchParams()
  useEffect(() => {
    const id = takeCheckoutSubject()
    if (id && !params.get('para'))
      setParams(
        (p) => {
          p.set('para', id)
          return p
        },
        { replace: true },
      )
  }, [params, setParams])
}
