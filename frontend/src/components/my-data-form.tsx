import { useMutation, useQuery } from '@tanstack/react-query'
import { CalendarIcon } from 'lucide-react'
import { useState } from 'react'
import { ErrorState } from '@/components/screen-state'
import { FieldMessage } from '@/components/status-alert'
import { Button } from '@/components/ui/button'
import { Field, FieldDescription, FieldLabel } from '@/components/ui/field'
import { Form } from '@/components/ui/form'
import { Input } from '@/components/ui/input'
import { InputGroup, InputGroupAddon, InputGroupInput } from '@/components/ui/input-group'
import { Skeleton } from '@/components/ui/skeleton'
import { api } from '@/lib/api'
import { errorText } from '@/lib/errors'
import { maskSpanishDate, parseSpanishDate } from '@/lib/format'
import { queryClient } from '@/lib/logout'
import { errorCode, toastError, toastOk } from '@/lib/notify'
import type { Me } from '@/lib/types'

export const useMeKey = ['me'] as const

// Mis datos: nombre y, solo si falta (alta con Google), la fecha de nacimiento. El email no se cambia (B18 lo deja fuera).
export function MyDataForm({ showEmail, submitLabel = 'Guardar', onSaved }: { showEmail?: boolean; submitLabel?: string; onSaved?: () => void }) {
  const me = useQuery({ queryKey: useMeKey, queryFn: () => api<Me>('/me') })
  const [birth, setBirth] = useState('')
  const [errors, setErrors] = useState<Record<string, string>>({})
  const save = useMutation({
    mutationFn: (body: Record<string, string>) => api<Me>('/me', { method: 'PATCH', body }),
    onSuccess: async () => {
      toastOk('Datos guardados')
      await Promise.all([queryClient.invalidateQueries({ queryKey: useMeKey }), queryClient.invalidateQueries({ queryKey: ['profile-status'] })])
      onSaved?.()
    },
    onError: (err) => {
      const code = errorCode(err)
      if (code === 'invalid_birth_date' || code === 'minor_cannot_register' || code === 'birth_date_already_set') setErrors({ birth_date: errorText(code) })
      else if (code === 'invalid_field_type') setErrors({ display_name: 'Escribe tu nombre.' })
      else toastError(err)
    },
  })

  if (me.isPending) return <Skeleton className="h-48 w-full rounded-2xl" />
  if (me.isError) return <ErrorState error={me.error} onRetry={() => void me.refetch()} />
  const askBirth = me.data.birth_date === null && me.data.role === 'alumno'

  function submit(v: Record<string, unknown>) {
    setErrors({})
    const body: Record<string, string> = { display_name: String(v.display_name).trim() }
    if (askBirth) {
      const iso = parseSpanishDate(birth)
      if (!iso) return setErrors({ birth_date: errorText('invalid_birth_date') })
      body.birth_date = iso
    }
    save.mutate(body)
  }

  return (
    <Form className="flex flex-col gap-4" errors={errors} onFormSubmit={submit}>
      <Field name="display_name" className="items-stretch">
        <FieldLabel>Nombre y apellidos</FieldLabel>
        <Input defaultValue={me.data.display_name ?? ''} autoComplete="name" required />
        <FieldMessage match="valueMissing">Escribe tu nombre.</FieldMessage>
        {errors.display_name && <FieldMessage>{errors.display_name}</FieldMessage>}
      </Field>
      {showEmail && (
        <Field name="email" className="items-stretch">
          <FieldLabel>Email</FieldLabel>
          <Input value={me.data.email} readOnly />
          <FieldDescription>Por ahora el email no se puede cambiar.</FieldDescription>
        </Field>
      )}
      {askBirth && (
        <Field name="birth_date" className="items-stretch">
          <FieldLabel>Fecha de nacimiento</FieldLabel>
          <InputGroup>
            <InputGroupInput inputMode="numeric" autoComplete="bday" placeholder="dd/mm/aaaa" maxLength={10} value={birth} onChange={(e) => setBirth(maskSpanishDate(e.target.value))} required />
            <InputGroupAddon align="inline-end" aria-hidden="true">
              <CalendarIcon />
            </InputGroupAddon>
          </InputGroup>
          <FieldMessage match="valueMissing">Escribe tu fecha de nacimiento.</FieldMessage>
          {errors.birth_date && <FieldMessage>{errors.birth_date}</FieldMessage>}
          <FieldDescription>Solo se pide una vez y no se puede cambiar después.</FieldDescription>
        </Field>
      )}
      <Button type="submit" size="xl" loading={save.isPending}>
        {submitLabel}
      </Button>
    </Form>
  )
}
