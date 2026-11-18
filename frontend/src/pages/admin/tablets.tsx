import { useQuery } from '@tanstack/react-query'
import { BanIcon, CheckIcon, CircleCheckIcon, CopyIcon, HourglassIcon, PlusIcon, TabletIcon, TimerOffIcon, TriangleAlertIcon, type LucideIcon } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { Tag } from '@/components/billing-bits'
import { Page } from '@/components/page'
import { EmptyState, ErrorState, ListSkeleton } from '@/components/screen-state'
import { Button } from '@/components/ui/button'
import { Dialog, DialogDescription, DialogFooter, DialogHeader, DialogPanel, DialogPopup, DialogTitle } from '@/components/ui/dialog'
import { Table, TableBody, TableCell, TableRow } from '@/components/ui/table'
import { useNow } from '@/hooks/use-now'
import { api } from '@/lib/api'
import { tabletStatus, type Tablet, type TabletStatus } from '@/lib/catalog'
import { formatLogDate, formatShortDate, formatTime } from '@/lib/format'
import { queryClient } from '@/lib/logout'
import { toastOk } from '@/lib/notify'
import { cn } from '@/lib/utils'
import { Head } from '@/pages/admin/catalog-bits'
import { FormSheet, TextField, useFieldError } from '@/pages/admin/schedule-bits'
import { post, useConfirm } from '@/pages/admin/user-billing'

const refresh = () => void queryClient.invalidateQueries({ queryKey: ['admin', 'tablets'] })

// Estado con icono y texto (DESIGN.md: nunca solo color).
const STATUS: Record<TabletStatus, [string, 'warning' | 'success' | 'secondary', LucideIcon]> = {
  waiting: ['Esperando vinculación', 'warning', HourglassIcon],
  expired: ['Código caducado', 'secondary', TimerOffIcon],
  linked: ['Vinculada', 'success', CircleCheckIcon],
  offline: ['Sin conexión', 'warning', TriangleAlertIcon],
  revoked: ['Revocada', 'secondary', BanIcon],
}
function StatusTag({ s }: { s: TabletStatus }) {
  const [label, variant, Icon] = STATUS[s]
  return (
    <Tag variant={variant}>
      <Icon aria-hidden="true" />
      {label}
    </Tag>
  )
}

// Lo que explica el estado: cuándo caduca o caducó el código, cuándo se revocó.
const statusNote = (t: Tablet, s: TabletStatus) =>
  s === 'waiting' && t.link_expires_at
    ? `El código caduca a las ${formatTime(t.link_expires_at)}`
    : s === 'expired' && t.link_expires_at
      ? `El código caducó el ${formatLogDate(t.link_expires_at)}. Revócala y crea otra`
      : s === 'revoked' && t.revoked_at
        ? `Revocada el ${formatLogDate(t.revoked_at)}`
        : null

type Issued = { name: string; code: string; expires: string | null }

// docs/pantallas-b19.md § Tablets y docs/pantallas-b22.md § Tablets y Ajustes.
export function AdminTabletsPage() {
  const list = useQuery({ queryKey: ['admin', 'tablets'], queryFn: () => api<{ tablets: Tablet[] }>('/admin/tablets').then((r) => r.tablets) })
  const [creating, setCreating] = useState(false)
  const now = useNow()
  // El código vive solo en este estado: no pasa por React Query (ni su caché de mutaciones) ni por el almacenamiento.
  const [issued, setIssued] = useState<Issued | null>(null)
  const { ask, dialog } = useConfirm(refresh)
  const revoke = (t: Tablet) =>
    ask({
      title: `¿Revocar ${t.name}?`,
      description: 'La tablet deja de mostrar el QR al momento. Para volver a usarla hay que vincular una nueva.',
      label: 'Revocar',
      done: 'Tablet revocada',
      destructive: true,
      run: post(`/admin/tablets/${t.id}/revoke`),
    })
  const revokeButton = (t: Tablet, className?: string) =>
    !t.revoked_at && (
      <Button variant="destructive-outline" size="sm" className={cn('h-11 sm:h-11', className)} aria-label={`Revocar ${t.name}`} onClick={() => revoke(t)}>
        Revocar
      </Button>
    )
  const date = (iso: string | null) => (iso ? formatLogDate(iso) : '—')
  return (
    <Page
      title="Tablets"
      wide
      actions={
        <Button size="lg" className="h-11 sm:h-11" onClick={() => setCreating(true)}>
          <PlusIcon />
          Nueva tablet
        </Button>
      }
    >
      {list.isPending ? (
        <ListSkeleton rows={3} className="h-16" />
      ) : list.isError ? (
        <ErrorState error={list.error} onRetry={() => void list.refetch()} />
      ) : list.data.length === 0 ? (
        <EmptyState icon={<TabletIcon />} title="No hay tablets" text="Crea una con «Nueva tablet» y vincúlala con su código." />
      ) : (
        <>
          {/* Hasta xl, una fila por tablet; la tabla solo desde xl, que con la barra lateral no cabe antes. */}
          <ul className="flex flex-col divide-y overflow-hidden rounded-2xl border bg-card xl:hidden">
            {list.data.map((t) => {
              const s = tabletStatus(t, now)
              const seen = [t.last_seen_at ? `Vista el ${formatLogDate(t.last_seen_at)}` : 'Nunca vista', t.linked_at && `vinculada el ${formatShortDate(t.linked_at)}`].filter(Boolean).join(' · ')
              return (
                <li key={t.id} className="flex flex-col gap-2 py-3 ps-4 pe-3 sm:flex-row sm:items-center sm:gap-4">
                  <div className="flex min-w-0 flex-1 flex-col gap-1">
                    <div className="flex items-start justify-between gap-3">
                      <p className={cn('min-w-0 font-semibold break-words', s === 'revoked' && 'text-muted-foreground')}>{t.name}</p>
                      <span className="shrink-0">
                        <StatusTag s={s} />
                      </span>
                    </div>
                    <p className="text-sm text-muted-foreground tabular-nums">{statusNote(t, s) ?? seen}</p>
                  </div>
                  {revokeButton(t, 'self-end sm:self-center')}
                </li>
              )
            })}
          </ul>
          <div className="hidden overflow-x-auto rounded-2xl border bg-card xl:block">
            <Table>
              <Head cols={['Nombre', 'Estado', 'Vinculada el', 'Vista por última vez', '']} end={[4]} />
              <TableBody>
                {list.data.map((t) => {
                  const s = tabletStatus(t, now)
                  const note = statusNote(t, s)
                  return (
                    <TableRow key={t.id}>
                      <TableCell className={cn('ps-4 leading-snug font-medium whitespace-normal break-words', s === 'revoked' && 'text-muted-foreground')}>{t.name}</TableCell>
                      <TableCell className="whitespace-normal">
                        <StatusTag s={s} />
                        {note && <p className="mt-1 text-xs text-muted-foreground tabular-nums">{note}</p>}
                      </TableCell>
                      <TableCell className="tabular-nums">{date(t.linked_at)}</TableCell>
                      <TableCell className="tabular-nums">{date(t.last_seen_at)}</TableCell>
                      <TableCell className="text-right">{revokeButton(t)}</TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          </div>
        </>
      )}
      {creating && <NewTablet onClose={() => setCreating(false)} onIssued={setIssued} />}
      <Dialog open={issued !== null} onOpenChange={(o) => !o && setIssued(null)}>
        {issued && <CodeDialog issued={issued} onClose={() => setIssued(null)} />}
      </Dialog>
      {dialog}
    </Page>
  )
}

// El código solo se ve aquí: grande para teclearlo, «Copiar» por si se pega, y lo que queda hasta que caduque.
function CodeDialog({ issued, onClose }: { issued: Issued; onClose: () => void }) {
  const now = useNow(15_000)
  const [copied, setCopied] = useState(false)
  const codeRef = useRef<HTMLParagraphElement>(null)
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined)
  useEffect(() => () => clearTimeout(timer.current), [])
  const left = issued.expires ? Math.ceil((new Date(issued.expires).getTime() - now) / 60_000) : null
  const gone = left !== null && left <= 0
  const [manual, setManual] = useState(false)
  const copy = () =>
    // Sin portapapeles (sin permiso o sin HTTPS no existe): lo dejamos seleccionado y lo decimos.
    (navigator.clipboard?.writeText(issued.code) ?? Promise.reject(new Error('no clipboard'))).then(
      () => {
        toastOk('Código copiado')
        setCopied(true)
        clearTimeout(timer.current)
        timer.current = setTimeout(() => setCopied(false), 2000)
      },
      () => {
        setManual(true)
        if (codeRef.current) window.getSelection()?.selectAllChildren(codeRef.current)
      },
    )
  return (
    <DialogPopup closeProps={{ 'aria-label': 'Cerrar' }}>
      <DialogHeader>
        <DialogTitle>Código de {issued.name}</DialogTitle>
        <DialogDescription className="tabular-nums">
          {gone ? 'El código ha caducado. Revoca esta tablet y crea otra.' : issued.expires ? `Caduca a las ${formatTime(issued.expires)} (en ${left} min); solo se ve ahora.` : 'Solo se ve ahora.'}
        </DialogDescription>
      </DialogHeader>
      <DialogPanel className="flex flex-col gap-3">
        <p
          ref={codeRef}
          aria-label="Código de vinculación"
          className={cn('rounded-xl border bg-muted px-4 py-6 text-center font-mono text-4xl font-semibold tracking-[0.15em] break-all tabular-nums select-all', gone && 'text-muted-foreground line-through')}
        >
          {issued.code}
        </p>
        <Button variant="outline" size="lg" className="h-11 self-center sm:h-11" disabled={gone} onClick={() => void copy()}>
          {copied ? <CheckIcon aria-hidden="true" /> : <CopyIcon aria-hidden="true" />}
          {copied ? 'Copiado' : 'Copiar'}
        </Button>
        {manual && !gone && (
          <p role="status" className="text-center text-sm text-muted-foreground">
            No se ha podido copiar: el código está seleccionado, cópialo a mano.
          </p>
        )}
        <p className="text-sm text-muted-foreground">
          En la tablet, abre <span className="font-mono">/tablet</span> y escribe este código. Sirve una sola vez. Si lo pierdes, revoca esta tablet y crea otra.
        </p>
      </DialogPanel>
      <DialogFooter>
        <Button size="xl" className="h-11 sm:h-11" onClick={onClose}>
          {gone ? 'Cerrar' : 'Ya lo he escrito'}
        </Button>
      </DialogFooter>
    </DialogPopup>
  )
}

function NewTablet({ onClose, onIssued }: { onClose: () => void; onIssued: (c: Issued) => void }) {
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const fe = useFieldError()
  const create = async () => {
    fe.clear()
    setBusy(true)
    try {
      const { tablet } = await api<{ tablet: Tablet & { link_code: string } }>('/admin/tablets', { method: 'POST', body: { name: name.trim() } })
      onIssued({ name: tablet.name, code: tablet.link_code, expires: tablet.link_expires_at })
      refresh()
    } catch (err) {
      fe.fail(err)
      throw err
    } finally {
      setBusy(false)
    }
  }
  return (
    <FormSheet
      open
      onClose={onClose}
      title="Nueva tablet"
      description="Te damos un código de un solo uso para vincularla. La tablet no es un usuario: solo muestra el QR del check-in."
      submitLabel="Crear y ver el código"
      disabled={!name.trim() || name.length > 100}
      loading={busy}
      onSubmit={create}
    >
      <TextField label="Nombre" value={name} onChange={setName} maxLength={100} placeholder="Recepción" error={fe.error('name') && 'Escribe un nombre de 1 a 100 caracteres.'} />
    </FormSheet>
  )
}
