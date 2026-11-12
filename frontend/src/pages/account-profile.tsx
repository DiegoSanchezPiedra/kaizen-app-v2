import { useMutation, useQuery } from '@tanstack/react-query'
import { ChevronLeftIcon, LockIcon } from 'lucide-react'
import { useState } from 'react'
import { Link } from 'react-router'
import { Page } from '@/components/page'
import { EmptyState, ErrorState, ListSkeleton } from '@/components/screen-state'
import { FieldMessage } from '@/components/status-alert'
import { Button } from '@/components/ui/button'
import { Field, FieldLabel } from '@/components/ui/field'
import { Form } from '@/components/ui/form'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { api } from '@/lib/api'
import { queryClient } from '@/lib/logout'
import { toastError, toastOk } from '@/lib/notify'
import { minorView } from '@/lib/minor'
import { useMinor } from '@/lib/queries'
import { NETWORKS, isHttps } from '@/lib/profile'
import { useSession } from '@/lib/session'
import type { MyProfile } from '@/lib/types'

const FIELDS: [string, string][] = [
  ['photo', 'Mi foto'],
  ['bio', 'Mi presentación'],
  ['social_links', 'Mis redes'],
  ['disciplines', 'Mis disciplinas'],
  ['member_since', 'Desde cuándo soy alumno'],
  ['achievements', 'Mis logros'],
  ['ranking', 'Aparecer en los rankings'],
]
// El profesor no tiene logros ni sale en los rankings.
const PROFESSOR_FIELDS = FIELDS.filter(([k]) => k !== 'achievements' && k !== 'ranking').map(([k, l]): [string, string] => [k, k === 'member_since' ? 'Desde cuándo estoy en la academia' : l])

function ProfileForm({ profile }: { profile: MyProfile }) {
  const role = useSession()?.role
  const [isPublic, setPublic] = useState(profile.is_public)
  const [visible, setVisible] = useState(profile.visible_fields)
  const [bio, setBio] = useState(profile.bio ?? '')
  const links = (profile.social_links as Record<string, string> | null) ?? {}
  const [urlErrors, setUrlErrors] = useState<Record<string, boolean>>({})
  const save = useMutation({
    mutationFn: (body: object) => api<MyProfile>('/me/profile', { method: 'PATCH', body }),
    onSuccess: async () => {
      toastOk('Perfil guardado')
      await queryClient.invalidateQueries({ queryKey: ['my-profile'] })
    },
    onError: (err) => toastError(err),
  })

  function submit(v: Record<string, unknown>) {
    const social = Object.fromEntries(NETWORKS.map(([k]) => [k, String(v[k] ?? '').trim()]).filter(([, u]) => u))
    const bad = Object.fromEntries(Object.entries(social).map(([k, u]) => [k, !isHttps(u as string)]))
    setUrlErrors(bad)
    if (Object.values(bad).some(Boolean)) return
    save.mutate({ is_public: isPublic, visible_fields: visible, bio: bio.trim() || null, social_links: Object.keys(social).length ? social : null })
  }

  return (
    <Form className="flex flex-col gap-5" errors={Object.fromEntries(Object.keys(urlErrors).filter((k) => urlErrors[k]).map((k) => [k, k]))} onFormSubmit={submit}>
      <label className="flex min-h-14 items-center justify-between gap-3 rounded-xl border bg-card px-4">
        <span>
          <span className="block font-semibold">Perfil público</span>
          <span className="block text-sm text-muted-foreground">{role === 'profesor' ? 'Los alumnos' : 'Otros alumnos'} podrán encontrarte en Comunidad.</span>
        </span>
        <Switch checked={isPublic} onCheckedChange={setPublic} />
      </label>
      <fieldset className="flex flex-col rounded-xl border bg-card px-4 py-1">
        <legend className="px-1 text-sm font-semibold">Qué se ve</legend>
        {(role === 'profesor' ? PROFESSOR_FIELDS : FIELDS).map(([key, label]) => (
          <label key={key} className="flex min-h-12 items-center justify-between gap-3 border-b last:border-b-0">
            <span className="text-[15px]">{label}</span>
            <Switch checked={visible[key] ?? false} onCheckedChange={(c) => setVisible((s) => ({ ...s, [key]: c }))} aria-label={label} />
          </label>
        ))}
      </fieldset>
      <Field name="bio" className="items-stretch">
        <FieldLabel>Presentación</FieldLabel>
        <Textarea value={bio} onChange={(e) => setBio(e.target.value)} maxLength={500} className="min-h-22" />
        <p className="text-right text-xs text-muted-foreground" aria-live="polite">{bio.length}/500</p>
      </Field>
      <fieldset className="flex flex-col gap-3">
        <legend className="mb-1 text-sm font-semibold">Redes</legend>
        {NETWORKS.map(([k, label]) => (
          <Field key={k} name={k} className="items-stretch">
            <FieldLabel>{label}</FieldLabel>
            <Input type="url" inputMode="url" placeholder="https://" defaultValue={links[k] ?? ''} aria-invalid={urlErrors[k] || undefined} />
            {urlErrors[k] && <FieldMessage>Usa un enlace que empiece por https://</FieldMessage>}
          </Field>
        ))}
      </fieldset>
      <Button type="submit" size="xl" loading={save.isPending}>
        Guardar
      </Button>
    </Form>
  )
}

// Perfil público propio. Un tutor no tiene (ni un hijo); un alumno que aún no cumple los requisitos, tampoco.
export function PublicProfilePage() {
  const role = useSession()?.role
  // B32: un menor por debajo de la edad de consentimiento no decide su perfil público: lo hace su tutor.
  const minor = useMinor()
  const locked = minor && !minorView(minor).publicProfile
  const query = useQuery({ queryKey: ['my-profile'], queryFn: () => api<MyProfile>('/me/profile'), enabled: role !== 'tutor' && !locked })
  return (
    <Page title="Perfil público">
      <Link to="/account" className="-mt-3 inline-flex min-h-11 items-center gap-1 self-start font-semibold text-link">
        <ChevronLeftIcon className="size-4" aria-hidden="true" />
        Cuenta
      </Link>
      {role === 'tutor' ? (
        <EmptyState icon={<LockIcon />} title="No disponible" text="Los tutores no tienen perfil público." />
      ) : locked ? (
        <EmptyState icon={<LockIcon />} title="Lo decide tu tutor" text="Hasta que tengas la edad para decidirlo, tu tutor elige si tu perfil es público y qué se ve." />
      ) : query.isPending ? (
        <ListSkeleton rows={3} />
      ) : query.isError ? (
        <ErrorState error={query.error} onRetry={() => void query.refetch()} />
      ) : !query.data.eligible ? (
        <EmptyState icon={<LockIcon />} title="No puedes tener perfil público" text="Solo pueden tenerlo los adultos con cuenta propia." />
      ) : (
        <ProfileForm profile={query.data} />
      )}
    </Page>
  )
}
