import { keepPreviousData, useMutation, useQuery } from '@tanstack/react-query'
import { MailIcon, MegaphoneIcon, MessageCircleIcon, PlusIcon, SmartphoneIcon } from 'lucide-react'
import { useId, useState } from 'react'
import { useSearchParams } from 'react-router'
import { Tag } from '@/components/billing-bits'
import { CommuniquePreview } from '@/components/communique-dialog'
import { ConfirmDialog } from '@/components/confirm-dialog'
import { EmptyState, ErrorState, ListSkeleton } from '@/components/screen-state'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Radio, RadioGroup } from '@/components/ui/radio-group'
import { Textarea } from '@/components/ui/textarea'
import { toastManager } from '@/components/ui/toast'
import { pageHref, pageOf, type Paged } from '@/lib/admin'
import { api } from '@/lib/api'
import { AUDIENCE_LABEL, BODY_MAX, CHANNEL_NAME, TITLE_MAX, whatsappUrl, type Audience, type Channel, type Communique } from '@/lib/communiques'
import { formatLogDate } from '@/lib/format'
import { queryClient } from '@/lib/logout'
import { toastError } from '@/lib/notify'
import { plural } from '@/lib/professor'
import { path } from '@/lib/url'
import { cn } from '@/lib/utils'
import { FormSheet, TextField, useAdminDisciplines, useFieldError } from '@/pages/admin/schedule-bits'
import { PAGE_SIZE, Pager } from '@/pages/admin/shell'

const KEY = ['admin', 'communiques']
const CHANNEL_ICON = { app: SmartphoneIcon, email: MailIcon, whatsapp: MessageCircleIcon }
const CHANNELS: { value: Channel; hint: string }[] = [
  { value: 'app', hint: 'Una ventana al abrir la app, hasta que pulsen «Entendido». Deja de salir a los 30 días.' },
  { value: 'email', hint: 'Solo de servicio: horarios, cierres, normas. Nada promocional (ofertas o productos necesitan consentimiento y baja).' },
  { value: 'whatsapp', hint: 'Tras enviar, «Compartir en WhatsApp» abre WhatsApp con el texto: elige el grupo de anuncios.' },
]
const AUDIENCE_HINT: Record<Audience, string> = {
  all: 'Alumnos, tutores y profesores con cuenta.',
  members: 'Con la cuota activa o en periodo de gracia. Un hijo, por sus tutores.',
  trainers: 'Solo el equipo.',
}
// Fila táctil de 56 px con su control, como las filas con casilla de la cuota.
const PICK_ROW = 'flex min-h-14 cursor-pointer items-start gap-3 px-4 py-3 transition-colors duration-150 ease-(--ease-out) hover:bg-accent has-data-checked:bg-primary/6'
// Enlace suelto en una fila: 44 px de objetivo con el ::after.
const rowLink = 'relative inline-flex items-center gap-1.5 font-medium text-link underline-offset-3 transition-colors duration-150 ease-out after:absolute after:-inset-x-1 after:-inset-y-3 hover:underline'

const has = (c: Pick<Communique, 'channels'>, ch: Channel) => c.channels.includes(ch)

const sentToast = (c: Communique) =>
  toastManager.add({
    type: 'success',
    title: 'Comunicado enviado',
    timeout: has(c, 'whatsapp') ? 15000 : 4000,
    // Desde el toast (un clic del admin): abrir wa.me al volver la API lo bloquearía el navegador.
    actionProps: has(c, 'whatsapp') ? { children: 'Compartir en WhatsApp', onClick: () => window.open(whatsappUrl(c), '_blank', 'noopener') } : undefined,
  })

// Tercera pestaña de Avisos (ADR 0030): enviar comunicados y su historial.
export function Communiques() {
  const [params] = useSearchParams()
  const page = pageOf(params)
  const [creating, setCreating] = useState(false)
  const list = useQuery({
    queryKey: [...KEY, page],
    queryFn: () => api<Paged<'rows', Communique>>(path('/admin/communiques', { limit: String(PAGE_SIZE), offset: String((page - 1) * PAGE_SIZE) })),
    placeholderData: keepPreviousData,
  })
  const create = (
    <Button size="xl" onClick={() => setCreating(true)}>
      <PlusIcon aria-hidden="true" />
      Nuevo comunicado
    </Button>
  )
  return (
    <div className="flex flex-col gap-4">
      {list.isPending ? (
        <ListSkeleton rows={3} className="h-28" />
      ) : list.isError ? (
        <ErrorState error={list.error} onRetry={() => void list.refetch()} />
      ) : list.data.total === 0 ? (
        <EmptyState icon={<MegaphoneIcon />} title="Aún no has enviado comunicados" text="Avisa de un cierre, un cambio de horario o una norma nueva: en la app, por email o por WhatsApp." action={create} />
      ) : (
        <>
          <div className="flex sm:justify-end [&>button]:w-full sm:[&>button]:w-auto">{create}</div>
          <ul className={cn('flex flex-col divide-y rounded-2xl border bg-card transition-opacity duration-150 ease-out', list.isPlaceholderData && 'opacity-60')} aria-busy={list.isPlaceholderData}>
            {list.data.rows.map((c) => (
              <Row key={c.id} c={c} />
            ))}
          </ul>
          <Pager total={list.data.total} page={page} href={(n) => pageHref(params, n)} />
        </>
      )}
      {creating && <NewCommunique onClose={() => setCreating(false)} />}
    </div>
  )
}

function Row({ c }: { c: Communique }) {
  const [asking, setAsking] = useState(false)
  const withdraw = useMutation({
    mutationFn: () => api(`/admin/communiques/${c.id}/withdraw`, { method: 'POST' }),
    onSuccess: () => {
      setAsking(false)
      toastManager.add({ type: 'success', title: 'Comunicado retirado', timeout: 4000 })
    },
    onError: (err) => toastError(err),
    onSettled: () => void queryClient.invalidateQueries({ queryKey: KEY }),
  })
  const live = !c.withdrawn_at
  const figures = [has(c, 'app') && `Visto por ${c.seen} de ${c.app_count}`, has(c, 'email') && plural(c.email_count, 'email', 'emails')].filter(Boolean)
  return (
    <li className="flex flex-col gap-1.5 px-4 py-3">
      <div className="flex items-start justify-between gap-3">
        <p className="min-w-0 font-medium break-words text-pretty">{c.title}</p>
        {!live && <Tag variant="secondary">Retirado</Tag>}
      </div>
      <p className="text-sm text-muted-foreground">
        {AUDIENCE_LABEL[c.audience]}
        {c.discipline_ids && ` · ${plural(c.discipline_ids.length, 'disciplina', 'disciplinas')}`}
        {' · '}
        <time dateTime={c.created_at} className="tabular-nums">
          {formatLogDate(c.created_at)}
        </time>
      </p>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        {c.channels.map((ch) => {
          const Icon = CHANNEL_ICON[ch]
          return (
            <Tag key={ch}>
              <Icon aria-hidden="true" />
              {CHANNEL_NAME[ch]}
            </Tag>
          )
        })}
        {figures.length > 0 && <span className="text-sm tabular-nums">{figures.join(' · ')}</span>}
      </div>
      {(has(c, 'whatsapp') || (live && has(c, 'app'))) && (
        <div className="mt-1 flex flex-wrap items-center gap-x-6 gap-y-2 text-sm">
          {has(c, 'whatsapp') && (
            <a href={whatsappUrl(c)} target="_blank" rel="noopener noreferrer" className={rowLink}>
              <MessageCircleIcon aria-hidden="true" className="size-4" />
              Compartir en WhatsApp
            </a>
          )}
          {live && has(c, 'app') && (
            <button type="button" onClick={() => setAsking(true)} className={cn(rowLink, 'text-destructive-foreground')}>
              Retirar
            </button>
          )}
        </div>
      )}
      <ConfirmDialog
        open={asking}
        onOpenChange={(o) => !o && !withdraw.isPending && setAsking(false)}
        title="¿Retirar el comunicado?"
        description="Deja de salir a quien aún no lo ha visto y no se mandan los emails que falten. Lo ya enviado no se deshace."
        confirmLabel="Retirar"
        loading={withdraw.isPending}
        onConfirm={() => withdraw.mutate()}
      />
    </li>
  )
}

const toggle = <T,>(xs: T[], x: T, on: boolean) => (on ? [...xs, x] : xs.filter((y) => y !== x))

function NewCommunique({ onClose }: { onClose: () => void }) {
  const [f, setF] = useState({ title: '', body: '', audience: 'all' as Audience, disciplines: [] as string[], channels: ['app'] as Channel[] })
  const fe = useFieldError()
  const ids = useId()
  const disciplines = useAdminDisciplines()
  const reaches = has(f, 'app') || has(f, 'email')
  const query = { audience: f.audience, ...(f.audience === 'members' && f.disciplines.length ? { discipline_ids: f.disciplines.join(',') } : {}) }
  const count = useQuery({
    queryKey: [...KEY, 'audience', query],
    queryFn: () => api<{ app: number; email: number }>(path('/admin/communiques/audience', query)),
    enabled: reaches,
  })
  const send = useMutation({
    mutationFn: () => {
      fe.clear()
      return api<Communique>('/admin/communiques', {
        method: 'POST',
        body: { title: f.title.trim(), body: f.body.trim(), audience: f.audience, discipline_ids: query.discipline_ids?.split(','), channels: f.channels },
      })
    },
    onSuccess: sentToast,
    onError: fe.fail,
    onSettled: () => void queryClient.invalidateQueries({ queryKey: KEY }),
  })
  // null: solo WhatsApp; undefined: aún sin la cifra.
  const total = !reaches ? null : count.data ? (has(f, 'app') ? count.data.app : count.data.email) : undefined
  const reach =
    total === null
      ? 'Solo WhatsApp: desde la app no le llega a nadie. Después, compártelo en el grupo de anuncios.'
      : total === undefined
        ? 'Calculando a cuántas personas llega…'
        : `Se enviará a ${plural(total, 'persona', 'personas')}${has(f, 'email') && has(f, 'app') ? ` (${count.data!.email} por email)` : ''}. No se puede editar después.`
  return (
    <FormSheet
      open
      onClose={onClose}
      title="Nuevo comunicado"
      description="Para avisar de algo del servicio: un cierre, un cambio de horario, una norma nueva."
      submitLabel="Enviar"
      disabled={!f.title.trim() || !f.body.trim() || !f.channels.length || total === 0 || total === undefined}
      loading={send.isPending}
      confirm={{ title: '¿Enviar el comunicado?', description: reach, children: <CommuniquePreview title={f.title.trim()} body={f.body.trim()} /> }}
      onSubmit={() => send.mutateAsync()}
    >
      <TextField label="Título" value={f.title} maxLength={TITLE_MAX} onChange={(title) => setF((x) => ({ ...x, title }))} hint={`${f.title.length} de ${TITLE_MAX}`} error={fe.error('title')} />
      <div className="flex flex-col gap-1.5">
        <label htmlFor={`${ids}-body`} className="text-sm font-medium">
          Texto
        </label>
        <Textarea id={`${ids}-body`} value={f.body} maxLength={BODY_MAX} onChange={(e) => setF((x) => ({ ...x, body: e.target.value }))} aria-invalid={fe.error('body') ? true : undefined} className="[&_textarea]:min-h-32" />
        <p className={cn('text-xs', fe.error('body') ? 'text-destructive-foreground' : 'text-muted-foreground')}>{fe.error('body') ?? `Sin formato. ${f.body.length} de ${BODY_MAX}`}</p>
      </div>
      <fieldset className="flex flex-col">
        <legend id={`${ids}-to`} className="mb-1.5 text-sm font-medium">
          Para
        </legend>
        <RadioGroup value={f.audience} onValueChange={(v) => setF((x) => ({ ...x, audience: v as Audience }))} aria-labelledby={`${ids}-to`} className="gap-0 divide-y overflow-hidden rounded-xl border bg-card">
          {(Object.keys(AUDIENCE_LABEL) as Audience[]).map((a) => (
            <label key={a} className={PICK_ROW}>
              <Radio value={a} className="mt-0.5" />
              <span className="flex flex-col">
                <span className="text-[15px] font-medium">{AUDIENCE_LABEL[a]}</span>
                <span className="text-xs text-muted-foreground">{AUDIENCE_HINT[a]}</span>
              </span>
            </label>
          ))}
        </RadioGroup>
      </fieldset>
      {f.audience === 'members' && (
        <fieldset className="flex flex-col">
          <legend className="mb-0.5 text-sm font-medium">Solo de estas disciplinas</legend>
          <p className="mb-1.5 text-xs text-muted-foreground">Ninguna marcada: todas.</p>
          <ul className="divide-y overflow-hidden rounded-xl border bg-card">
            {(disciplines.data ?? [])
              .filter((d) => d.is_active)
              .map((d) => (
                <li key={d.id}>
                  <label className={cn(PICK_ROW, 'items-center')}>
                    <Checkbox checked={f.disciplines.includes(String(d.id))} onCheckedChange={(on) => setF((x) => ({ ...x, disciplines: toggle(x.disciplines, String(d.id), on) }))} />
                    <span className="text-[15px] font-medium">{d.name}</span>
                  </label>
                </li>
              ))}
          </ul>
        </fieldset>
      )}
      <fieldset className="flex flex-col">
        <legend className="mb-1.5 text-sm font-medium">Canales</legend>
        <ul className="divide-y overflow-hidden rounded-xl border bg-card">
          {CHANNELS.map(({ value, hint }) => {
            const Icon = CHANNEL_ICON[value]
            return (
              <li key={value}>
                <label className={PICK_ROW}>
                  <Checkbox className="mt-0.5" checked={has(f, value)} onCheckedChange={(on) => setF((x) => ({ ...x, channels: toggle(x.channels, value, on) }))} />
                  <span className="flex flex-col">
                    <span className="flex items-center gap-1.5 text-[15px] font-medium">
                      <Icon aria-hidden="true" className="size-4 text-muted-foreground" />
                      {CHANNEL_NAME[value]}
                    </span>
                    <span className="text-xs text-pretty text-muted-foreground">{hint}</span>
                  </span>
                </label>
              </li>
            )
          })}
        </ul>
        {fe.error('channels') && <p className="mt-1.5 text-xs text-destructive-foreground">Elige al menos un canal.</p>}
      </fieldset>
      {reaches && (
        <p className="text-sm text-muted-foreground" aria-live="polite">
          {total === 0 ? 'Nadie cumple estas condiciones: cambia el «Para».' : reach}
        </p>
      )}
    </FormSheet>
  )
}
