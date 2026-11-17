import { useMutation, useQuery } from '@tanstack/react-query'
import { CheckIcon, ExternalLinkIcon, FileTextIcon } from 'lucide-react'
import { useEffect, useId, useRef, useState } from 'react'
import { CARD } from '@/components/child-access'
import { ErrorState } from '@/components/screen-state'
import { StatusAlert } from '@/components/status-alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Skeleton } from '@/components/ui/skeleton'
import { ApiError, api } from '@/lib/api'
import { fetchAgreement } from '@/lib/agreements'
import { errorText } from '@/lib/errors'
import { queryClient } from '@/lib/logout'
import { toastError, toastOk, errorCode } from '@/lib/notify'
import { cn } from '@/lib/utils'
import { AGREEMENT_TITLE, type AgreementType } from '@/lib/profile'
import type { ProfileStatus } from '@/lib/types'

function Agreement({ type, signed, profileId, row }: { type: AgreementType; signed: boolean; profileId?: string; row?: boolean }) {
  const [read, setRead] = useState(false)
  const title = useRef<HTMLHeadingElement>(null)
  const doc = useQuery({
    queryKey: ['agreement-doc', type],
    queryFn: () => fetchAgreement(type),
    enabled: !signed,
    gcTime: 0,
    retry: false,
  })
  const url = doc.data?.url
  useEffect(() => () => (url ? URL.revokeObjectURL(url) : undefined), [url])

  const sign = useMutation({
    mutationFn: () => api('/me/agreements', { method: 'POST', body: { type, version: doc.data!.version, profile_id: profileId } }),
    onSuccess: () => {
      toastOk(`${AGREEMENT_TITLE[type]} firmado`)
      // El botón desaparece al firmar: el foco pasa al título del acuerdo en vez de perderse.
      title.current?.focus()
      return queryClient.invalidateQueries({ queryKey: ['profile-status'] })
    },
    onError: (err) => {
      toastError(err)
      // Se publicó otra versión mientras tanto: se vuelve a bajar para que la lea.
      if (errorCode(err) === 'invalid_version') void doc.refetch()
      if (errorCode(err) === 'agreement_already_signed') void queryClient.invalidateQueries({ queryKey: ['profile-status'] })
      setRead(false)
    },
  })

  const unpublished = doc.error instanceof ApiError && doc.error.code === 'no_current_document'
  const head = (
    <div className="flex items-center justify-between gap-3">
      <h3 ref={title} tabIndex={-1} className="flex items-center gap-2 text-base font-semibold outline-none">
        <FileTextIcon className="size-5 text-muted-foreground" aria-hidden="true" />
        {AGREEMENT_TITLE[type]}
      </h3>
      {/* key: al firmar, «Firmado» entra con un fundido en vez de sustituir a «Pendiente» de golpe. */}
      {signed ? (
        <Badge key="ok" variant="success" size="lg" className={cn(row && 'enter-soft')}>
          <CheckIcon aria-hidden="true" />
          Firmado
        </Badge>
      ) : (
        <Badge key="no" variant="warning" size="lg">
          Pendiente
        </Badge>
      )}
    </div>
  )
  // Con el documento ya bajado sigue montado al firmar, para que el pliegue lo cierre en vez de quitarlo de golpe.
  const body = (
    <>
      {!signed && doc.isPending && <Skeleton className="h-24 w-full rounded-xl" />}
      {!signed && unpublished && <StatusAlert notice={{ kind: 'info', title: errorText('no_current_document') }} />}
      {!signed && doc.isError && !unpublished && <ErrorState error={doc.error} onRetry={() => void doc.refetch()} />}
      {(row || !signed) && doc.data && (
        <>
          <a
            href={doc.data.url}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex min-h-11 items-center gap-2 self-start font-semibold text-link underline underline-offset-3"
          >
            Leer el documento (PDF)
            <ExternalLinkIcon className="size-4" aria-hidden="true" />
          </a>
          <label className="flex min-h-11 cursor-pointer items-center gap-3 text-[15px]">
            <Checkbox checked={read} onCheckedChange={(c) => setRead(c === true)} />
            He leído y acepto este documento<span className="sr-only">: {AGREEMENT_TITLE[type]}</span>
          </label>
          <Button size="xl" className={cn(row && 'mt-2')} disabled={!read} loading={sign.isPending} onClick={() => sign.mutate()}>
            Firmar<span className="sr-only"> {AGREEMENT_TITLE[type]}</span>
          </Button>
        </>
      )}
    </>
  )
  if (row) {
    return (
      <div className="flex flex-col py-3 first:pt-1 last:pb-0" aria-label={AGREEMENT_TITLE[type]} role="group">
        {head}
        {/* Firmado, se pliega en 200 ms (como una fila resuelta de HomeSteps) y el Tab lo salta. */}
        <div
          data-testid={`agreement-${type}`}
          inert={signed}
          className={cn('grid transition-[grid-template-rows,opacity] duration-200 ease-(--ease-out) motion-reduce:transition-opacity', signed ? 'grid-rows-[0fr] opacity-0' : 'grid-rows-[1fr] opacity-100')}
        >
          {/* -mx/px: que el anillo de foco no quede recortado por overflow-hidden. */}
          <div className="-mx-1 min-h-0 overflow-hidden px-1">
            {/* El relleno va dentro: en el elemento de la rejilla no se pliega y dejaría hueco. */}
            <div className="flex flex-col gap-1 pt-2">{body}</div>
          </div>
        </div>
      </div>
    )
  }
  return (
    <section className="flex flex-col gap-3 rounded-2xl border bg-card p-4" aria-label={AGREEMENT_TITLE[type]}>
      {head}
      {body}
    </section>
  )
}

// Los acuerdos de un sujeto: firmado o pendiente según `missing`. Con `title`, una tarjeta con su estado y una fila
// por acuerdo (/agreements); sin él, una tarjeta por acuerdo (onboarding).
export function AgreementsPanel({ types, status, profileId, title }: { types: AgreementType[]; status: ProfileStatus; profileId?: string; title?: string }) {
  const missing = status.missing ?? []
  const id = useId()
  if (title) {
    const n = types.filter((t) => missing.includes(t)).length
    return (
      <section aria-labelledby={id} className={cn(CARD, 'enter-soft')}>
        <div className="flex flex-col gap-0.5">
          <h2 id={id} className="text-lg font-semibold">
            {title}
          </h2>
          <p className="text-sm text-muted-foreground">{n ? `${n === 1 ? 'Falta' : 'Faltan'} ${n} por firmar` : 'Todo firmado'}</p>
        </div>
        <div className="flex flex-col divide-y">
          {types.map((t) => (
            <Agreement key={t} type={t} signed={!missing.includes(t)} profileId={profileId} row />
          ))}
        </div>
      </section>
    )
  }
  return (
    <div className="flex flex-col gap-3">
      {types.map((t) => (
        <Agreement key={t} type={t} signed={!missing.includes(t)} profileId={profileId} />
      ))}
    </div>
  )
}
