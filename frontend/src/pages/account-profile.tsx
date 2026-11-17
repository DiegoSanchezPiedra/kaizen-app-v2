import { useMutation, useQuery } from '@tanstack/react-query'
import { ChevronLeftIcon, LockIcon } from 'lucide-react'
import { useState } from 'react'
import { Link } from 'react-router'
import { AvatarEditor } from '@/components/avatar-editor'
import { CARD } from '@/components/child-access'
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
import { useMe, useMinor } from '@/lib/queries'
import { NETWORKS, isHttps } from '@/lib/profile'
import { useSession } from '@/lib/session'
import type { MyProfile } from '@/lib/types'
import { cn } from '@/lib/utils'

const BIO_MAX = 500

// Los campos de visible_fields que no son la foto (la foto va aparte, junto a ella).
const FIELDS: [string, string][] = [
  ['bio', 'Presentación'],
  ['social_links', 'Redes'],
  ['disciplines', 'Disciplinas'],
  ['member_since', 'Desde cuándo soy alumno'],
  ['achievements', 'Logros'],
  ['ranking', 'Aparecer en los rankings'],
]
// El profesor no tiene logros ni sale en los rankings.
const PROFESSOR_FIELDS = FIELDS.filter(([k]) => k !== 'achievements' && k !== 'ranking').map(([k, l]): [string, string] => [k, k === 'member_since' ? 'Desde cuándo estoy en la academia' : l])

type Patch = { is_public?: boolean; visible_fields?: Record<string, boolean>; bio?: string | null; social_links?: Record<string, string> | null }
const KEY = ['my-profile']
// Todos los PATCH del perfil van en fila (scope): cada respuesta trae el perfil entero tras el anterior.
const PATCH = { mutationKey: KEY, scope: { id: 'my-profile' }, mutationFn: (body: Patch) => api<MyProfile>('/me/profile', { method: 'PATCH', body }) }
// La respuesta trae el perfil entero: se pinta, salvo que queden otros en fila (pisaría lo que ya se ve de ellos).
const store = (p: MyProfile) => queryClient.isMutating({ mutationKey: KEY }) <= 1 && queryClient.setQueryData(KEY, p)

// Cada interruptor guarda al pulsarlo (como en la ficha del hijo).
function VisibilityCard({ profile }: { profile: MyProfile }) {
  const role = useSession()?.role
  const me = useMe()
  const set = useMutation({
    ...PATCH,
    // Se ve ya lo pedido, sin bloquear los demás interruptores mientras guarda.
    onMutate: (body) => queryClient.setQueryData<MyProfile>(KEY, (p) => p && { ...p, ...body, visible_fields: { ...p.visible_fields, ...body.visible_fields } }),
    onSuccess: store,
    // Si falla, vuelve lo que de verdad hay guardado.
    onError: (err) => {
      toastError(err)
      void queryClient.invalidateQueries({ queryKey: KEY })
    },
  })
  const on = profile.is_public
  const visible = profile.visible_fields
  // El servidor mezcla visible_fields con lo que ya había: se manda solo el campo que cambia.
  const field = (key: string, label: string) => (
    <label key={key} className="flex min-h-12 items-center justify-between gap-3 border-t">
      <span className="text-[15px]">{label}</span>
      <Switch checked={visible[key] ?? false} aria-label={label} onCheckedChange={(c) => set.mutate({ visible_fields: { [key]: c } })} />
    </label>
  )
  return (
    <section aria-labelledby="profile-card" className={cn('enter-soft', CARD)}>
      {/* El nombre ya hace de título visible; el h2 queda para el lector de pantalla. */}
      <h2 id="profile-card" className="sr-only">
        Tu ficha
      </h2>
      <AvatarEditor name={me.data?.display_name ?? null} avatar={me.data?.avatar}>
        <p className="truncate text-lg font-semibold">{me.data?.display_name ?? 'Sin nombre'}</p>
      </AvatarEditor>
      <div className="flex flex-col">
        <label className="flex min-h-14 items-center justify-between gap-3 border-t py-2">
          <span>
            <span className="block font-semibold">{role === 'profesor' ? 'Visible para los alumnos' : 'Visible para otros alumnos'}</span>
            <span className="block text-sm text-pretty text-muted-foreground">{role === 'profesor' ? 'Podrán ver tu ficha.' : 'Podrán ver tu ficha desde los rankings.'}</span>
          </span>
          <Switch checked={on} onCheckedChange={(c) => set.mutate({ is_public: c })} />
        </label>
        {/* Apagado, lo que se ve no cuenta: se pliega (sin perder los valores) y el Tab lo salta. */}
        <div
          data-testid="profile-fields"
          inert={!on}
          className={cn('grid transition-[grid-template-rows,opacity] ease-(--ease-out) motion-reduce:transition-opacity', on ? 'grid-rows-[1fr] opacity-100 duration-200' : 'grid-rows-[0fr] opacity-0 duration-150')}
        >
          {/* -mx/px: que el anillo de foco no quede recortado por overflow-hidden. */}
          <div className="-mx-1 flex min-h-0 flex-col overflow-hidden px-1">
            {field('photo', 'Foto pública')}
            <fieldset aria-labelledby="profile-what" className="flex flex-col">
              <p id="profile-what" className="border-t pt-4 pb-1 text-sm font-semibold text-muted-foreground">
                Qué se ve
              </p>
              {(role === 'profesor' ? PROFESSOR_FIELDS : FIELDS).map(([k, l]) => field(k, l))}
            </fieldset>
          </div>
        </div>
      </div>
    </section>
  )
}

function TextCard({ profile }: { profile: MyProfile }) {
  const [bio, setBio] = useState(profile.bio ?? '')
  const links = (profile.social_links as Record<string, string> | null) ?? {}
  const [urlErrors, setUrlErrors] = useState<Record<string, boolean>>({})
  const save = useMutation({
    ...PATCH,
    onSuccess: (p) => {
      store(p)
      toastOk('Perfil guardado')
    },
    onError: (err) => toastError(err),
  })
  const left = BIO_MAX - bio.length
  const hidden = [!profile.visible_fields.bio && 'la presentación', !profile.visible_fields.social_links && 'las redes'].filter(Boolean)
  const note = !profile.is_public
    ? 'Se verán cuando tu perfil sea público.'
    : hidden.length
      ? `Ahora no se ven ${hidden.join(' ni ')}: actívalo arriba, en «Qué se ve».`
      : 'Se ven en tu ficha.'

  function submit(v: Record<string, unknown>) {
    const social = Object.fromEntries(NETWORKS.map(([k]) => [k, String(v[k] ?? '').trim()]).filter(([, u]) => u))
    const bad = Object.fromEntries(Object.entries(social).map(([k, u]) => [k, !isHttps(u as string)]))
    setUrlErrors(bad)
    if (Object.values(bad).some(Boolean)) return
    const body = { bio: bio.trim() || null, social_links: Object.keys(social).length ? social : null }
    const saved = Object.fromEntries(NETWORKS.map(([k]) => [k, links[k]]).filter(([, u]) => u))
    // Sin cambios no se llama a la API (como en Mis datos).
    if (body.bio === (profile.bio ?? null) && JSON.stringify(social) === JSON.stringify(saved)) return void toastOk('Perfil guardado')
    save.mutate(body)
  }

  return (
    <section aria-labelledby="profile-text" className={cn('enter-soft', CARD)}>
      <div>
        <h2 id="profile-text" className="text-lg font-semibold">
          Presentación y redes
        </h2>
        <p className="text-sm text-pretty text-muted-foreground">{note}</p>
      </div>
      <Form className="flex flex-col gap-4" errors={Object.fromEntries(Object.keys(urlErrors).filter((k) => urlErrors[k]).map((k) => [k, k]))} onFormSubmit={submit}>
        <Field name="bio" className="items-stretch">
          <FieldLabel>Presentación</FieldLabel>
          {/* Arranca a dos líneas y crece al escribir (field-sizing-content). */}
          <Textarea value={bio} onChange={(e) => setBio(e.target.value)} maxLength={BIO_MAX} className="[&_textarea]:min-h-16" />
          <p className="text-right text-xs text-muted-foreground tabular-nums" aria-hidden="true">
            {bio.length}/{BIO_MAX}
          </p>
          {/* Al lector de pantalla solo cuando se acerca el límite, no en cada tecla. */}
          <p className="sr-only" aria-live="polite">
            {left <= 50 ? `Quedan ${left} caracteres` : ''}
          </p>
        </Field>
        {NETWORKS.map(([k, label]) => (
          <Field key={k} name={k} className="items-stretch">
            <FieldLabel>{label}</FieldLabel>
            <Input type="url" inputMode="url" placeholder="https://" defaultValue={links[k] ?? ''} aria-invalid={urlErrors[k] || undefined} />
            {urlErrors[k] && <FieldMessage>Usa un enlace que empiece por https://</FieldMessage>}
          </Field>
        ))}
        <Button type="submit" size="xl" loading={save.isPending}>
          Guardar
        </Button>
      </Form>
    </section>
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
        <>
          <VisibilityCard profile={query.data} />
          <TextCard profile={query.data} />
        </>
      )}
    </Page>
  )
}
