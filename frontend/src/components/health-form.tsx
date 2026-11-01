import { useMutation, useQuery } from '@tanstack/react-query'
import { ErrorState } from '@/components/screen-state'
import { FieldMessage } from '@/components/status-alert'
import { Button } from '@/components/ui/button'
import { Field, FieldLabel } from '@/components/ui/field'
import { Form } from '@/components/ui/form'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { Textarea } from '@/components/ui/textarea'
import { api } from '@/lib/api'
import { queryClient } from '@/lib/logout'
import { toastError, toastOk } from '@/lib/notify'
import { path } from '@/lib/queries'
import type { Health } from '@/lib/types'

const TEXT_FIELDS: [keyof Health, string, string?][] = [
  ['injuries', 'Lesiones', 'Las que tengas o hayas tenido.'],
  ['conditions', 'Condiciones médicas'],
  ['medication', 'Medicación'],
  ['allergies', 'Alergias'],
]

// Ficha de salud del sujeto. Solo se muestra aquí, a quien la rellena (nunca en listas ni en Inicio) y se descarta
// de la memoria al salir (gcTime 0).
export function HealthForm({ profileId, onSaved }: { profileId?: string; onSaved?: () => void }) {
  const query = useQuery({
    queryKey: ['health', profileId ?? 'self'],
    queryFn: () => api<{ health: Health | null }>(path('/me/health', { profile_id: profileId })).then((r) => r.health),
    gcTime: 0,
  })
  const save = useMutation({
    mutationFn: (v: Record<string, FormDataEntryValue>) =>
      api('/me/health', { method: 'POST', body: { profile_id: profileId, ...Object.fromEntries(Object.entries(v).map(([k, x]) => [k, String(x).trim() || null])) } }),
    onSuccess: async () => {
      toastOk('Ficha guardada')
      await queryClient.invalidateQueries({ queryKey: ['profile-status'] })
      onSaved?.()
    },
    onError: (err) => toastError(err),
  })

  if (query.isPending) return <Skeleton className="h-96 w-full rounded-2xl" />
  if (query.isError) return <ErrorState error={query.error} onRetry={() => void query.refetch()} />
  const h = query.data
  return (
    <Form className="flex flex-col gap-4" onFormSubmit={(v) => save.mutate(v as Record<string, FormDataEntryValue>)}>
      <p className="text-sm text-muted-foreground">Solo la ven quienes la necesitan para cuidarte en la sesión.</p>
      {TEXT_FIELDS.map(([name, label, hint]) => (
        <Field key={name} name={name} className="items-stretch">
          <FieldLabel>{label}</FieldLabel>
          <Textarea defaultValue={h?.[name] ?? ''} maxLength={1000} className="min-h-22" />
          {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
        </Field>
      ))}
      <Field name="previous_experience" className="items-stretch">
        <FieldLabel>Experiencia previa</FieldLabel>
        <Input defaultValue={h?.previous_experience ?? ''} maxLength={300} />
      </Field>
      <Field name="previous_discipline" className="items-stretch">
        <FieldLabel>Disciplina previa</FieldLabel>
        <Input defaultValue={h?.previous_discipline ?? ''} maxLength={300} />
      </Field>
      <fieldset className="flex flex-col gap-4 rounded-2xl border p-4">
        <legend className="px-1 text-sm font-semibold">Contacto de emergencia (obligatorio)</legend>
        <Field name="emergency_contact_name" className="items-stretch">
          <FieldLabel>Nombre</FieldLabel>
          <Input defaultValue={h?.emergency_contact_name ?? ''} autoComplete="off" required />
          <FieldMessage match="valueMissing">Pon a quién llamamos si pasa algo.</FieldMessage>
        </Field>
        <Field name="emergency_contact_phone" className="items-stretch">
          <FieldLabel>Teléfono</FieldLabel>
          <Input type="tel" inputMode="tel" autoComplete="off" defaultValue={h?.emergency_contact_phone ?? ''} required />
          <FieldMessage match="valueMissing">Pon un teléfono de contacto.</FieldMessage>
        </Field>
      </fieldset>
      <Button type="submit" size="xl" loading={save.isPending}>
        Guardar ficha
      </Button>
    </Form>
  )
}
