import { useMutation } from '@tanstack/react-query'
import { useState } from 'react'
import { Kv } from '@/components/billing-bits'
import { cancelledText, pauseEnd, perMonth, shortDay } from '@/lib/billing'
import { formatShortDate } from '@/lib/format'
import { toastError, toastOk } from '@/lib/notify'
import type { Subscription } from '@/lib/types'
import { Filter } from '@/pages/community'
import { FormSheet, SelectField } from '@/pages/admin/schedule-bits'

// Pedir la pausa (B30): meses, lo que pasa y confirmación. Lo usan el pagador y el admin; `request` hace la llamada.
// `name`: el alumno (tercera persona); sin él, habla de «tu».
export function PauseSheet({
  s,
  name,
  admin,
  request,
  onClose,
  onDone,
}: {
  s: Subscription
  name?: string
  admin?: boolean
  request: (months: number) => Promise<{ ends_at: string; cancelled_bookings: number }>
  onClose: () => void
  onDone: () => void
}) {
  const cfg = s.pause_settings!
  const [months, setMonths] = useState('1')
  const n = Number(months)
  const start = s.current_period_end!
  const ends = pauseEnd(start, n)
  const ask = useMutation({
    mutationFn: () => request(n),
    onSuccess: (r) => toastOk(`Pausa programada hasta el ${formatShortDate(r.ends_at)}`, cancelledText(r.cancelled_bookings)),
    onError: (err) => toastError(err),
    onSettled: onDone,
  })
  return (
    <FormSheet
      open
      onClose={onClose}
      title="Pausar la membresía"
      description={`Empieza en la próxima fecha de cobro, el ${formatShortDate(start)}, y dura los meses que elijas. Hasta entonces todo sigue igual.`}
      submitLabel="Pausar"
      loading={ask.isPending}
      confirm={{
        title: '¿Pausar la membresía?',
        description: `Del ${formatShortDate(start)} al ${shortDay(ends)}, ${perMonth(cfg.price_cents!)} de cuota de mantenimiento. Se cancelan las reservas de esos días${admin ? ' y se avisa al pagador' : ''}. Se puede anular gratis hasta que empiece.`,
      }}
      onSubmit={() => ask.mutateAsync()}
    >
      <SelectField label="Meses de pausa">
        <Filter
          label="Meses de pausa"
          value={months}
          onChange={setMonths}
          items={Array.from({ length: cfg.max_months }, (_, i) => ({ value: String(i + 1), label: i === 0 ? '1 mes' : `${i + 1} meses` }))}
        />
      </SelectField>
      <Kv
        rows={[
          ['Empieza', formatShortDate(start)],
          ['Termina', shortDay(ends)],
          ['Cuota de mantenimiento', perMonth(cfg.price_cents!)],
        ]}
      />
      <ul className="flex list-disc flex-col gap-1.5 pl-5 text-sm text-muted-foreground">
        <li>Durante la pausa {name ? `${name} no puede` : 'no se puede'} reservar ni entrar en la lista de espera.</li>
        <li>Se cancelan las reservas y esperas de los días de la pausa; anularla después no las devuelve.</li>
        <li>En vez del precio del plan se cobra la cuota de mantenimiento cada mes (impuestos incluidos).</li>
        <li>Al acabar, la membresía vuelve sola a {s.plan.name} con sus disciplinas.</li>
        <li>Se puede anular gratis hasta que empiece, o volver antes una vez empezada: la vuelta es en la siguiente fecha de cobro.</li>
      </ul>
    </FormSheet>
  )
}
