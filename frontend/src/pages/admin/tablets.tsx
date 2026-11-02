import { useQuery } from '@tanstack/react-query'
import { PlusIcon, TabletIcon } from 'lucide-react'
import { useState } from 'react'
import { Tag } from '@/components/billing-bits'
import { Page } from '@/components/page'
import { EmptyState, ErrorState, ListSkeleton } from '@/components/screen-state'
import { Button } from '@/components/ui/button'
import { Dialog, DialogDescription, DialogFooter, DialogHeader, DialogPanel, DialogPopup, DialogTitle } from '@/components/ui/dialog'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { useNow } from '@/hooks/use-now'
import { api } from '@/lib/api'
import { tabletState, type Tablet, type TabletState } from '@/lib/catalog'
import { formatDeadline, formatTime } from '@/lib/format'
import { queryClient } from '@/lib/logout'
import { FormSheet, TextField, useFieldError } from '@/pages/admin/schedule-bits'
import { post, useConfirm } from '@/pages/admin/user-billing'

const refresh = () => void queryClient.invalidateQueries({ queryKey: ['admin', 'tablets'] })

const STATE: Record<TabletState, [string, 'warning' | 'success' | 'secondary']> = {
  waiting: ['Esperando vinculación', 'warning'],
  linked: ['Vinculada', 'success'],
  revoked: ['Revocada', 'secondary'],
}

// docs/pantallas-b19.md § Tablets.
export function AdminTabletsPage() {
  const list = useQuery({ queryKey: ['admin', 'tablets'], queryFn: () => api<{ tablets: Tablet[] }>('/admin/tablets').then((r) => r.tablets) })
  const [creating, setCreating] = useState(false)
  const now = useNow()
  // El código vive solo en este estado: no pasa por React Query (ni su caché de mutaciones) ni por el almacenamiento.
  const [issued, setIssued] = useState<{ name: string; code: string; expires: string } | null>(null)
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
  return (
    <Page
      title="Tablets"
      wide
      actions={
        <Button size="lg" onClick={() => setCreating(true)}>
          <PlusIcon />
          Nueva tablet
        </Button>
      }
    >
      {list.isPending ? (
        <ListSkeleton rows={3} className="h-10" />
      ) : list.isError ? (
        <ErrorState error={list.error} onRetry={() => void list.refetch()} />
      ) : list.data.length === 0 ? (
        <EmptyState icon={<TabletIcon />} title="No hay tablets" text="Crea una con «Nueva tablet» y vincúlala con su código." />
      ) : (
        <div className="overflow-x-auto rounded-2xl border bg-card">
          <Table>
            <TableHeader className="sticky top-0 bg-card">
              <TableRow>
                {['Nombre', 'Estado', 'Vinculada el', 'Vista por última vez', ''].map((h, i) => (
                  <TableHead key={h || 'acciones'} className={i ? undefined : 'ps-4'}>
                    {h || <span className="sr-only">Acciones</span>}
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {list.data.map((t) => {
                const [label, variant] = STATE[tabletState(t)]
                const expired = tabletState(t) === 'waiting' && !!t.link_expires_at && new Date(t.link_expires_at).getTime() < now
                return (
                  <TableRow key={t.id} className={t.revoked_at ? 'h-10 text-muted-foreground' : 'h-10'}>
                    <TableCell className="ps-4 font-medium">{t.name}</TableCell>
                    <TableCell>
                      <Tag variant={variant}>{label}</Tag>
                      {expired && <span className="ms-2 text-xs text-muted-foreground">el código caducó</span>}
                    </TableCell>
                    <TableCell className="tabular-nums">{t.linked_at ? formatDeadline(t.linked_at) : '—'}</TableCell>
                    <TableCell className="tabular-nums">{t.last_seen_at ? formatDeadline(t.last_seen_at) : '—'}</TableCell>
                    <TableCell className="text-right">
                      {!t.revoked_at && (
                        <Button variant="ghost" size="sm" aria-label={`Revocar ${t.name}`} onClick={() => revoke(t)}>
                          Revocar
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        </div>
      )}
      {creating && <NewTablet onClose={() => setCreating(false)} onIssued={setIssued} />}
      <Dialog open={issued !== null} onOpenChange={(o) => !o && setIssued(null)}>
        {issued && (
          <DialogPopup closeProps={{ 'aria-label': 'Cerrar' }}>
            <DialogHeader>
              <DialogTitle>Código de {issued.name}</DialogTitle>
              <DialogDescription>Caduca a las {issued.expires}; solo se ve ahora.</DialogDescription>
            </DialogHeader>
            <DialogPanel className="flex flex-col gap-3">
              <p aria-label="Código de vinculación" className="rounded-xl border bg-muted px-4 py-6 text-center font-mono text-4xl font-semibold tracking-[0.2em] break-all select-all">
                {issued.code}
              </p>
              <p className="text-sm text-muted-foreground">
                En la tablet, abre <span className="font-mono">/tablet</span> y escribe este código. Sirve una sola vez. Si lo pierdes, revoca esta tablet y crea otra.
              </p>
            </DialogPanel>
            <DialogFooter>
              <Button size="xl" onClick={() => setIssued(null)}>
                Ya lo he escrito
              </Button>
            </DialogFooter>
          </DialogPopup>
        )}
      </Dialog>
      {dialog}
    </Page>
  )
}

function NewTablet({ onClose, onIssued }: { onClose: () => void; onIssued: (c: { name: string; code: string; expires: string }) => void }) {
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const fe = useFieldError()
  const create = async () => {
    fe.clear()
    setBusy(true)
    try {
      const { tablet } = await api<{ tablet: Tablet & { link_code: string } }>('/admin/tablets', { method: 'POST', body: { name: name.trim() } })
      onIssued({ name: tablet.name, code: tablet.link_code, expires: tablet.link_expires_at ? formatTime(tablet.link_expires_at) : '' })
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
      <TextField label="Nombre" value={name} onChange={setName} maxLength={100} placeholder="Recepción" error={fe.error('name')} />
    </FormSheet>
  )
}
