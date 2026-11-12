import { UsersIcon } from 'lucide-react'
import type React from 'react'
import { Link } from 'react-router'
import { EmptyState, ErrorState, ListSkeleton } from '@/components/screen-state'
import { Button } from '@/components/ui/button'
import { useSubject } from '@/hooks/use-subject'
import { errorText } from '@/lib/errors'
import { useMe } from '@/lib/queries'
import { useSession } from '@/lib/session'
import type { Subject } from '@/lib/subject'

// Pantallas que actúan por un sujeto: espera a /me/children y, si es un tutor sin hijos, pide añadirlos.
export function SubjectGate({ children }: { children: (s: { subject: Subject | null; profileId?: string }) => React.ReactNode }) {
  const session = useSession()
  const { subject, profileId, loading, error, retry } = useSubject()
  const canCreate = useMe().data?.can_create_children
  if (loading) return <ListSkeleton />
  if (error) return <ErrorState error={error} onRetry={retry} />
  if (session?.role === 'tutor' && !subject) {
    return (
      <EmptyState
        icon={<UsersIcon />}
        title="Añade a tus hijos"
        text={canCreate ? 'Como tutor, reservas y haces el seguimiento por ellos. Empieza dándolos de alta.' : errorText('child_creation_not_allowed')}
        action={
          canCreate && (
            <Button size="xl" render={<Link to="/account/children" />}>
              Añadir hijos
            </Button>
          )
        }
      />
    )
  }
  return <>{children({ subject, profileId })}</>
}

// Nombre del sujeto para los textos («Para Pau»): vacío si es uno mismo.
export const subjectName = (s: Subject | null): string | undefined => (s && !s.self ? s.label : undefined)
