import { useMutation, useQuery } from '@tanstack/react-query'
import { CheckIcon, ExternalLinkIcon, FileTextIcon } from 'lucide-react'
import { useEffect, useState } from 'react'
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
import { AGREEMENT_TITLE, type AgreementType } from '@/lib/profile'
import type { ProfileStatus } from '@/lib/types'

function Agreement({ type, signed, profileId }: { type: AgreementType; signed: boolean; profileId?: string }) {
  const [read, setRead] = useState(false)
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
  return (
    <section className="flex flex-col gap-3 rounded-2xl border bg-card p-4" aria-label={AGREEMENT_TITLE[type]}>
      <div className="flex items-center justify-between gap-3">
        <h3 className="flex items-center gap-2 text-base font-semibold">
          <FileTextIcon className="size-5 text-muted-foreground" aria-hidden="true" />
          {AGREEMENT_TITLE[type]}
        </h3>
        {signed ? (
          <Badge variant="success" size="lg">
            <CheckIcon aria-hidden="true" />
            Firmado
          </Badge>
        ) : (
          <Badge variant="warning" size="lg">
            Pendiente
          </Badge>
        )}
      </div>
      {!signed && doc.isPending && <Skeleton className="h-24 w-full rounded-xl" />}
      {!signed && unpublished && <StatusAlert notice={{ kind: 'info', title: errorText('no_current_document') }} />}
      {!signed && doc.isError && !unpublished && <ErrorState error={doc.error} onRetry={() => void doc.refetch()} />}
      {!signed && doc.data && (
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
          <Button size="xl" disabled={!read} loading={sign.isPending} onClick={() => sign.mutate()}>
            Firmar<span className="sr-only"> {AGREEMENT_TITLE[type]}</span>
          </Button>
        </>
      )}
    </section>
  )
}

// Los acuerdos de un sujeto: firmado o pendiente según `missing`.
export function AgreementsPanel({ types, status, profileId }: { types: AgreementType[]; status: ProfileStatus; profileId?: string }) {
  const missing = status.missing ?? []
  return (
    <div className="flex flex-col gap-3">
      {types.map((t) => (
        <Agreement key={t} type={t} signed={!missing.includes(t)} profileId={profileId} />
      ))}
    </div>
  )
}
