import { useMutation, useQuery } from '@tanstack/react-query'
import { ArchiveIcon, ChevronRightIcon, CircleCheckIcon, FilePenIcon, FileTextIcon, UploadIcon } from 'lucide-react'
import { useId, useState } from 'react'
import { Note, Tag } from '@/components/billing-bits'
import { Page } from '@/components/page'
import { ErrorState, ListSkeleton } from '@/components/screen-state'
import { Button } from '@/components/ui/button'
import { Dialog, DialogDescription, DialogFooter, DialogHeader, DialogPanel, DialogPopup, DialogTitle } from '@/components/ui/dialog'
import { api, ApiError } from '@/lib/api'
import { DOC_TYPES, docTitle, groupDocuments, pdfProblem, type AgreementDoc, type DocGroup } from '@/lib/catalog'
import { formatShortDate } from '@/lib/format'
import { queryClient } from '@/lib/logout'
import { errorText } from '@/lib/errors'
import { toastError, toastOk } from '@/lib/notify'
import { plural } from '@/lib/professor'
import { cn } from '@/lib/utils'
import { path } from '@/lib/url'
import { Filter } from '@/components/filter'
import { SelectField, TextField } from '@/pages/admin/schedule-bits'
import { post, useConfirm } from '@/pages/admin/user-billing'

const refresh = () => void queryClient.invalidateQueries({ queryKey: ['admin', 'documents'] })

// El PDF va con Bearer, así que no se abre con un enlace: se baja y se abre su URL temporal. La pestaña se abre antes
// de esperar, para que el navegador no la tome por una ventana emergente.
async function openPdf(id: string) {
  const tab = window.open('', '_blank')
  try {
    const url = URL.createObjectURL(await api<Blob>(`/admin/agreements/documents/${id}/file`, { blob: true }))
    if (tab) tab.location.href = url
    else window.open(url, '_blank')
    setTimeout(() => URL.revokeObjectURL(url), 60_000)
  } catch (err) {
    tab?.close()
    toastError(err)
  }
}

// docs/pantallas-b19.md § Documentos legales. Un documento no se retira a secas: se retira publicando otro del mismo tipo.
export function AdminDocumentsPage() {
  const [uploading, setUploading] = useState(false)
  const list = useQuery({ queryKey: ['admin', 'documents'], queryFn: () => api<{ documents: AgreementDoc[] }>('/admin/agreements/documents').then((r) => r.documents) })
  const { ask, dialog } = useConfirm(refresh)
  const publish = (d: AgreementDoc) =>
    ask({
      title: `¿Publicar ${docTitle(d.type).toLowerCase()} ${d.version}?`,
      description: `Retira la versión vigente. Todos los que la firmaron tendrán que volver a firmar y no podrán reservar hasta hacerlo; se les avisa.`,
      label: 'Publicar y avisar',
      done: 'Documento publicado',
      destructive: true,
      run: post(`/admin/agreements/documents/${d.id}/publish`),
    })
  return (
    <Page
      title="Documentos legales"
      wide
      actions={
        <Button size="lg" onClick={() => setUploading(true)}>
          <UploadIcon />
          Subir
        </Button>
      }
    >
      {list.isPending ? (
        <ListSkeleton rows={3} className="h-28" />
      ) : list.isError ? (
        <ErrorState error={list.error} onRetry={() => void list.refetch()} />
      ) : (
        groupDocuments(list.data).map((g) => <Group key={g.type} g={g} onPublish={publish} />)
      )}
      {uploading && <Upload onClose={() => setUploading(false)} />}
      {dialog}
    </Page>
  )
}

const when = (d: AgreementDoc) =>
  d.status === 'retired' && d.published_at && d.retired_at
    ? `vigente del ${formatShortDate(d.published_at)} al ${formatShortDate(d.retired_at)}`
    : d.published_at
      ? `publicado el ${formatShortDate(d.published_at)}`
      : `subido el ${formatShortDate(d.created_at)}`

const TAG = {
  published: ['success', CircleCheckIcon, 'Vigente'],
  created: ['warning', FilePenIcon, 'Borrador'],
  retired: ['secondary', ArchiveIcon, 'Retirado'],
} as const

// Versión e insignia arriba, la fecha debajo; las acciones a la derecha (en móvil caben así sin partir la fecha).
function Row({ d, onPublish }: { d: AgreementDoc; onPublish?: () => void }) {
  const [variant, Icon, label] = TAG[d.status]
  return (
    <li className="flex min-h-16 items-center gap-3 py-2.5 ps-4 pe-3">
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="font-semibold whitespace-nowrap tabular-nums">Versión {d.version}</span>
          <Tag variant={variant}>
            <Icon aria-hidden="true" />
            {label}
          </Tag>
        </span>
        <span className="text-sm text-muted-foreground first-letter:uppercase">{when(d)}</span>
      </span>
      <span className="flex shrink-0 flex-wrap items-center justify-end gap-2">
        <Button variant="ghost" size="sm" className="h-11 sm:h-11 max-sm:min-w-11" aria-label={`Ver el PDF de la versión ${d.version}`} onClick={() => void openPdf(d.id)}>
          <FileTextIcon />
          <span className="max-sm:sr-only">Ver el PDF</span>
        </Button>
        {onPublish && (
          <Button size="sm" className="h-11 sm:h-11" aria-label={`Publicar la versión ${d.version}`} onClick={onPublish}>
            Publicar
          </Button>
        )}
      </span>
    </li>
  )
}

// La vigente y los borradores a la vista; los retirados, plegados (solo hacen falta para consultar qué firmó alguien).
function Group({ g, onPublish }: { g: DocGroup; onPublish: (d: AgreementDoc) => void }) {
  const live = [...(g.current ? [g.current] : []), ...g.drafts]
  return (
    <section aria-labelledby={`doc-${g.type}`} className="flex flex-col gap-3">
      <h2 id={`doc-${g.type}`} className="font-heading text-lg font-bold">
        {docTitle(g.type)}
      </h2>
      {!g.current && (
        <Note kind="error" title="Aún no hay documento publicado: nadie puede completar su perfil">
          {g.drafts.length ? 'Publica el borrador.' : 'Súbelo con «Subir» y publícalo.'}
        </Note>
      )}
      {(live.length > 0 || g.retired.length > 0) && (
        <div className="overflow-hidden rounded-2xl border bg-card">
          {live.length > 0 && (
            <ul className="divide-y">
              {live.map((d) => (
                <Row key={d.id} d={d} onPublish={d.status === 'created' ? () => onPublish(d) : undefined} />
              ))}
            </ul>
          )}
          {g.retired.length > 0 && (
            <details className={cn('group', live.length > 0 && 'border-t')}>
              <summary className="flex min-h-12 cursor-pointer list-none items-center gap-2 px-4 text-sm font-medium text-muted-foreground transition-colors duration-150 ease-out outline-none hover:bg-accent/50 focus-visible:bg-accent/50 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset [&::-webkit-details-marker]:hidden">
                <ChevronRightIcon aria-hidden="true" className="size-4 transition-transform duration-200 ease-out group-open:rotate-90 motion-reduce:transition-none" />
                {plural(g.retired.length, 'versión anterior', 'versiones anteriores')}
              </summary>
              <ul className="divide-y border-t">
                {g.retired.map((d) => (
                  <Row key={d.id} d={d} />
                ))}
              </ul>
            </details>
          )}
        </div>
      )}
    </section>
  )
}

// El cuerpo es el PDF crudo (`api()` lo manda tal cual si es un Blob); tipo y versión van en la query.
function Upload({ onClose }: { onClose: () => void }) {
  const [type, setType] = useState('')
  const [version, setVersion] = useState('')
  const [file, setFile] = useState<File | null>(null)
  // El error de la API en su campo: la versión o el PDF. Se borra al cambiar ese campo.
  const [server, setServer] = useState<{ field: 'version' | 'file'; text: string } | null>(null)
  const pdfId = useId()
  const pdfErrId = useId()
  const problem = pdfProblem(type, version, file)
  const send = useMutation({
    mutationFn: () => api('/admin/agreements/documents' + path('', { type, version: version.trim() }), { method: 'POST', body: file }),
    onSuccess: () => {
      toastOk('Documento subido', 'Queda como borrador hasta que lo publiques.')
      onClose()
    },
    onError: (err) => {
      const code = err instanceof ApiError ? err.code : ''
      // invalid_version del admin no es el del alumno («hay una versión nueva»): se explica aquí.
      if (code === 'invalid_version') setServer({ field: 'version', text: 'La versión se escribe como 1.0 o 2.1.' })
      else if (code === 'version_exists_different_content') setServer({ field: 'version', text: errorText(code) })
      else if (code === 'duplicate_document' || code === 'invalid_file') setServer({ field: 'file', text: errorText(code) })
      else toastError(err)
    },
    onSettled: refresh,
  })
  // Lo que falta se dice al elegir el PDF, no antes: con el formulario vacío, el botón desactivado basta.
  const fileError = server?.field === 'file' ? server.text : file ? problem : null
  return (
    <Dialog open onOpenChange={(o) => !o && !send.isPending && onClose()}>
      <DialogPopup closeProps={{ 'aria-label': 'Cerrar' }}>
        <form
          className="flex min-h-0 flex-1 flex-col"
          onSubmit={(e) => {
            e.preventDefault()
            if (!problem && !send.isPending) send.mutate()
          }}
        >
          <DialogHeader>
            <DialogTitle>Subir un documento</DialogTitle>
            <DialogDescription>Queda como borrador: nadie lo ve hasta que lo publiques.</DialogDescription>
          </DialogHeader>
          <DialogPanel className="flex flex-col gap-4">
            <SelectField label="Tipo">
              <Filter
                label="Tipo"
                value={type || 'none'}
                onChange={(v) => setType(v === 'none' ? '' : v)}
                items={[{ value: 'none', label: 'Elige el tipo' }, ...DOC_TYPES.map((t) => ({ value: t, label: docTitle(t) }))]}
              />
            </SelectField>
            <TextField
              label="Versión"
              value={version}
              onChange={(v) => {
                setVersion(v)
                setServer(null)
              }}
              placeholder="1.0"
              hint="Dos números separados por un punto: 1.0, 1.1, 2.0."
              error={server?.field === 'version' ? server.text : undefined}
            />
            <div className="flex flex-col gap-1.5">
              <label htmlFor={pdfId} className="text-sm font-medium">
                PDF
              </label>
              {/* El botón nativo dice «Choose File» o «Seleccionar archivo» según el navegador: uno propio, en español,
                  con el input transparente encima (el clic, el teclado y el lector siguen siendo los del input). */}
              <span className="relative flex min-h-11 items-center gap-3 rounded-lg border border-input bg-background px-1.5 ring-ring/24 transition-shadow has-focus-visible:border-ring has-focus-visible:ring-[3px] has-aria-invalid:border-destructive/36 dark:bg-input/32">
                <input
                  id={pdfId}
                  type="file"
                  accept="application/pdf"
                  className="absolute inset-0 cursor-pointer opacity-0"
                  aria-invalid={!!fileError || undefined}
                  aria-describedby={fileError ? pdfErrId : undefined}
                  onChange={(e) => {
                    setFile(e.target.files?.[0] ?? null)
                    setServer(null)
                  }}
                />
                <span aria-hidden="true" className="pointer-events-none flex h-8 shrink-0 items-center gap-1.5 rounded-md border bg-secondary px-2.5 text-sm font-medium">
                  <FileTextIcon className="size-4 opacity-80" />
                  Elegir el PDF
                </span>
                <span aria-hidden="true" className="pointer-events-none min-w-0 truncate text-sm text-muted-foreground">
                  {file?.name ?? 'Ningún archivo'}
                </span>
              </span>
              {fileError ? (
                <p id={pdfErrId} role="alert" className="text-xs text-destructive-foreground">
                  {fileError}
                </p>
              ) : (
                <p className="text-xs text-muted-foreground">Hasta 10 MB.</p>
              )}
            </div>
          </DialogPanel>
          <DialogFooter>
            <Button type="button" variant="outline" size="xl" disabled={send.isPending} onClick={onClose}>
              Cancelar
            </Button>
            <Button type="submit" size="xl" disabled={!!problem} loading={send.isPending}>
              Subir como borrador
            </Button>
          </DialogFooter>
        </form>
      </DialogPopup>
    </Dialog>
  )
}
