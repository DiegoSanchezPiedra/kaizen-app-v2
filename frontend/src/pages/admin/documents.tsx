import { useMutation, useQuery } from '@tanstack/react-query'
import { FileTextIcon, UploadIcon } from 'lucide-react'
import { useId, useState } from 'react'
import type React from 'react'
import { Note, Tag } from '@/components/billing-bits'
import { Page } from '@/components/page'
import { EmptyState, ErrorState, ListSkeleton } from '@/components/screen-state'
import { Button } from '@/components/ui/button'
import { Dialog, DialogDescription, DialogFooter, DialogHeader, DialogPanel, DialogPopup, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { api, ApiError } from '@/lib/api'
import { DOC_TYPES, docTitle, groupDocuments, pdfProblem, type AgreementDoc, type DocGroup } from '@/lib/catalog'
import { formatShortDate } from '@/lib/format'
import { queryClient } from '@/lib/logout'
import { toastError, toastOk } from '@/lib/notify'
import { path } from '@/lib/url'
import { Filter } from '@/pages/community'
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

function Row({ d, tag, onPublish }: { d: AgreementDoc; tag?: React.ReactNode; onPublish?: () => void }) {
  return (
    <li className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3">
      <span className="font-semibold tabular-nums">Versión {d.version}</span>
      {tag}
      <span className="min-w-0 flex-1 text-sm text-muted-foreground">{when(d)}</span>
      <Button variant="ghost" size="sm" aria-label={`Ver el PDF de la versión ${d.version}`} onClick={() => void openPdf(d.id)}>
        <FileTextIcon />
        Ver el PDF
      </Button>
      {onPublish && (
        <Button size="sm" aria-label={`Publicar la versión ${d.version}`} onClick={onPublish}>
          Publicar
        </Button>
      )}
    </li>
  )
}

function Group({ g, onPublish }: { g: DocGroup; onPublish: (d: AgreementDoc) => void }) {
  return (
    <section aria-labelledby={`doc-${g.type}`} className="flex flex-col gap-3">
      <h2 id={`doc-${g.type}`} className="font-heading text-lg font-bold">
        {docTitle(g.type)}
      </h2>
      {!g.current && (
        <Note kind="error" title="Aún no hay documento publicado: nadie puede completar su perfil">
          {g.drafts.length ? 'Publica uno de los borradores.' : 'Sube uno con «Subir» y publícalo.'}
        </Note>
      )}
      {g.current || g.drafts.length || g.retired.length ? (
        <ul className="divide-y rounded-2xl border bg-card">
          {g.current && <Row d={g.current} tag={<Tag variant="success">Vigente</Tag>} />}
          {g.drafts.map((d) => (
            <Row key={d.id} d={d} tag={<Tag variant="warning">Borrador</Tag>} onPublish={() => onPublish(d)} />
          ))}
          {g.retired.map((d) => (
            <Row key={d.id} d={d} tag={<Tag variant="secondary">Retirado</Tag>} />
          ))}
        </ul>
      ) : (
        <EmptyState icon={<FileTextIcon />} title="Sin documentos" />
      )}
    </section>
  )
}

// El cuerpo es el PDF crudo (`api()` lo manda tal cual si es un Blob); tipo y versión van en la query.
function Upload({ onClose }: { onClose: () => void }) {
  const [type, setType] = useState('')
  const [version, setVersion] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const [serverVersion, setServerVersion] = useState(false)
  const pdfId = useId()
  const problem = pdfProblem(type, version, file)
  const send = useMutation({
    mutationFn: () => api('/admin/agreements/documents' + path('', { type, version: version.trim() }), { method: 'POST', body: file }),
    onSuccess: () => {
      toastOk('Documento subido', 'Queda como borrador hasta que lo publiques.')
      onClose()
    },
    // invalid_version del admin no es el del alumno («hay una versión nueva»): se explica aquí.
    onError: (err) => (err instanceof ApiError && err.code === 'invalid_version' ? setServerVersion(true) : toastError(err)),
    onSettled: refresh,
  })
  return (
    <Dialog open onOpenChange={(o) => !o && !send.isPending && onClose()}>
      <DialogPopup closeProps={{ 'aria-label': 'Cerrar' }}>
        <form
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
                setServerVersion(false)
              }}
              placeholder="1.0"
              hint="Dos números separados por un punto: 1.0, 1.1, 2.0."
              error={serverVersion ? 'La versión se escribe como 1.0 o 2.1.' : undefined}
            />
            <div className="flex flex-col gap-1.5">
              <label htmlFor={pdfId} className="text-sm font-medium">
                PDF
              </label>
              <Input id={pdfId} type="file" accept="application/pdf" size="lg" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
              <p className="text-xs text-muted-foreground">Hasta 10 MB.</p>
            </div>
            {(file || version) && problem && (
              <p role="alert" className="text-sm text-destructive-foreground">
                {problem}
              </p>
            )}
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
