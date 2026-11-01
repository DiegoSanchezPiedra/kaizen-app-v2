import { useQuery } from '@tanstack/react-query'
import { useSearchParams } from 'react-router'
import { api } from '@/lib/api'
import { useSession } from '@/lib/session'
import { activeSubject, subjectOptions, type Child } from '@/lib/subject'

// El sujeto activo vive en ?para= y en la caché en memoria de /me/children; nunca en localStorage.
export function useSubject() {
  const session = useSession()
  const [params, setParams] = useSearchParams()
  const enabled = session?.role === 'alumno' || session?.role === 'tutor'
  const { data, isPending } = useQuery({
    queryKey: ['me', 'children'],
    queryFn: () => api<{ children: Child[] }>('/me/children'),
    enabled,
  })
  const options = session && data ? subjectOptions(session.role, session.id, data.children) : []
  const subject = activeSubject(options, params.get('para'))
  const select = (id: string) =>
    setParams((p) => {
      p.set('para', id)
      return p
    })
  return {
    options,
    subject,
    // Para uno mismo no se manda: el calendario solo acepta profile_id de un hijo (o del admin) y responde 403.
    profileId: subject && !subject.self ? subject.id : undefined,
    loading: enabled && isPending,
    select,
  }
}
