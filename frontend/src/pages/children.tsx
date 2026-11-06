import { useMutation, useQuery } from '@tanstack/react-query'
import { CalendarIcon, ChevronLeftIcon, ChevronRightIcon, PlusIcon, UsersIcon } from 'lucide-react'
import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import { AvatarEditor } from '@/components/avatar-editor'
import { Page } from '@/components/page'
import { ProfileAvatar } from '@/components/profile-avatar'
import { EmptyState, ErrorState, ListSkeleton } from '@/components/screen-state'
import { FieldMessage, StatusAlert } from '@/components/status-alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Field, FieldLabel } from '@/components/ui/field'
import { Form } from '@/components/ui/form'
import { Input } from '@/components/ui/input'
import { InputGroup, InputGroupAddon, InputGroupInput } from '@/components/ui/input-group'
import { api } from '@/lib/api'
import { errorText } from '@/lib/errors'
import { isoToSpanish, maskSpanishDate, parseSpanishDate } from '@/lib/format'
import { queryClient } from '@/lib/logout'
import { errorCode, toastError, toastOk } from '@/lib/notify'
import type { Child } from '@/lib/subject'

// Misma clave que el selector de sujeto: una sola lectura de /me/children.
const useChildren = () => useQuery({ queryKey: ['me', 'children'], queryFn: () => api<{ children: Child[] }>('/me/children').then((r) => r.children) })

const Back = () => (
  <Link to="/account/children" className="-mt-3 inline-flex min-h-11 items-center gap-1 self-start font-semibold text-link">
    <ChevronLeftIcon className="size-4" aria-hidden="true" />
    Mis hijos
  </Link>
)

export function ChildrenPage() {
  const children = useChildren()
  return (
    <Page title="Mis hijos">
      <Link to="/account" className="-mt-3 inline-flex min-h-11 items-center gap-1 self-start font-semibold text-link">
        <ChevronLeftIcon className="size-4" aria-hidden="true" />
        Cuenta
      </Link>
      {children.isPending ? (
        <ListSkeleton rows={2} className="h-16" />
      ) : children.isError ? (
        <ErrorState error={children.error} onRetry={() => void children.refetch()} />
      ) : (
        <>
          {children.data.length === 0 ? (
            <EmptyState icon={<UsersIcon />} title="Aún no has añadido a nadie" text="Da de alta a tus hijos menores para reservar y seguir su progreso desde tu cuenta." />
          ) : (
            <ul className="overflow-hidden rounded-xl border bg-card">
              {children.data.map((c) => (
                <li key={c.id} className="border-b last:border-b-0">
                  <Link to={`/account/children/${c.id}`} className="flex min-h-14 items-center gap-3 px-4 py-2 outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset">
                    <ProfileAvatar name={c.display_name} avatar={c.avatar} className="size-10" />
                    <span className="min-w-0 flex-1 truncate font-semibold">{c.display_name}</span>
                    {c.pending_claim && <Badge variant="info" size="lg">Mayor de edad</Badge>}
                    <ChevronRightIcon className="size-4 text-muted-foreground" aria-hidden="true" />
                  </Link>
                </li>
              ))}
            </ul>
          )}
          <Button size="xl" render={<Link to="/account/children/new" />}>
            <PlusIcon />
            Añadir hijo o hija
          </Button>
        </>
      )}
    </Page>
  )
}

// Alta (sin :id) y edición de nombre y fecha de nacimiento. Un pending_claim ya es mayor de edad: solo lectura.
export function ChildFormPage() {
  const { id } = useParams()
  const navigate = useNavigate()
  const children = useChildren()
  const child = id ? children.data?.find((c) => c.id === id) : undefined
  const [birth, setBirth] = useState<string | null>(null)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const value = birth ?? (child?.birth_date ? isoToSpanish(child.birth_date) : '')

  const save = useMutation({
    mutationFn: (body: { display_name: string; birth_date: string }) =>
      id ? api(`/me/children/${id}`, { method: 'PATCH', body }) : api('/me/children', { method: 'POST', body }),
    onSuccess: async () => {
      toastOk(id ? 'Datos guardados' : 'Hijo o hija añadido')
      await queryClient.invalidateQueries({ queryKey: ['me', 'children'] })
      void navigate('/account/children')
    },
    onError: (err) => {
      const code = errorCode(err)
      if (code === 'child_must_be_minor' || code === 'invalid_birth_date') setErrors({ birth_date: errorText(code) })
      else toastError(err)
    },
  })

  if (id && children.isPending) return <Page title="Hijo o hija"><Back /><ListSkeleton rows={2} /></Page>
  if (children.isError) return <Page title="Hijo o hija"><Back /><ErrorState error={children.error} onRetry={() => void children.refetch()} /></Page>
  if (id && !child) return <Page title="Hijo o hija"><Back /><StatusAlert notice={{ kind: 'error', title: errorText('child_not_found') }} /></Page>

  function submit(v: Record<string, unknown>) {
    const iso = parseSpanishDate(value)
    if (!iso) return setErrors({ birth_date: errorText('invalid_birth_date') })
    setErrors({})
    save.mutate({ display_name: String(v.display_name).trim(), birth_date: iso })
  }

  if (child?.pending_claim) {
    return (
      <Page title={child.display_name}>
        <Back />
        <StatusAlert notice={{ kind: 'info', icon: 'info', title: 'Ya es mayor de edad', text: 'Para seguir, habla con la academia.' }} />
      </Page>
    )
  }

  return (
    <Page title={id ? 'Editar hijo o hija' : 'Añadir hijo o hija'}>
      <Back />
      {child && <AvatarEditor name={child.display_name} avatar={child.avatar} profileId={child.id} />}
      <Form className="flex flex-col gap-4" errors={errors} onFormSubmit={submit}>
        <Field name="display_name" className="items-stretch">
          <FieldLabel>Nombre y apellidos</FieldLabel>
          <Input defaultValue={child?.display_name ?? ''} required autoFocus={!id} />
          <FieldMessage match="valueMissing">Escribe su nombre.</FieldMessage>
        </Field>
        <Field name="birth_date" className="items-stretch">
          <FieldLabel>Fecha de nacimiento</FieldLabel>
          <InputGroup>
            <InputGroupInput inputMode="numeric" placeholder="dd/mm/aaaa" maxLength={10} value={value} onChange={(e) => setBirth(maskSpanishDate(e.target.value))} required />
            <InputGroupAddon align="inline-end" aria-hidden="true">
              <CalendarIcon />
            </InputGroupAddon>
          </InputGroup>
          <FieldMessage match="valueMissing">Escribe su fecha de nacimiento.</FieldMessage>
          {errors.birth_date && <FieldMessage>{errors.birth_date}</FieldMessage>}
        </Field>
        <Button type="submit" size="xl" loading={save.isPending}>
          {id ? 'Guardar' : 'Añadir'}
        </Button>
      </Form>
    </Page>
  )
}
