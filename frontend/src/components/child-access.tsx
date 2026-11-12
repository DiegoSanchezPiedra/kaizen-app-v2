import { useMutation } from '@tanstack/react-query'
import { useId, useState } from 'react'
import { ConfirmDialog } from '@/components/confirm-dialog'
import { PasswordInput } from '@/components/password-input'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Switch } from '@/components/ui/switch'
import { FormSheet, TextField } from '@/pages/admin/schedule-bits'
import { Kv } from '@/components/billing-bits'
import { ApiError, api } from '@/lib/api'
import { errorText } from '@/lib/errors'
import { queryClient } from '@/lib/logout'
import { ACCESS_NOTICE, ACCESS_NOTICE_VERSION } from '@/lib/minor-access'
import { errorCode, toastError, toastOk } from '@/lib/notify'
import type { Child, ChildAccess } from '@/lib/subject'
import { NETWORKS, isHttps } from '@/lib/profile'

const refresh = () => queryClient.invalidateQueries({ queryKey: ['me', 'children'] })
// Un fallo de campo se queda en la hoja (junto al campo); el resto, en un aviso.
const fieldOf = (code: string): 'username' | 'password' | 'email' | null =>
  code === 'invalid_username' || code === 'username_taken' ? 'username' : code === 'weak_password' ? 'password' : code === 'email_requires_14' || code === 'email_taken' ? 'email' : null

function PasswordField({ label, value, onChange, error }: { label: string; value: string; onChange: (v: string) => void; error?: string }) {
  const id = useId()
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-sm font-medium">
        {label}
      </label>
      <PasswordInput id={id} autoComplete="new-password" value={value} onChange={(e) => onChange(e.target.value)} aria-invalid={error ? true : undefined} />
      <p role={error ? 'alert' : undefined} className={error ? 'text-xs text-destructive-foreground' : 'text-xs text-muted-foreground'}>
        {error ?? 'Mínimo 8 caracteres.'}
      </p>
    </div>
  )
}

// ── Acceso propio ────────────────────────────────────────────────────────

function InfoNotice() {
  const n = ACCESS_NOTICE
  return (
    <div className="flex flex-col gap-3 rounded-xl border bg-muted/40 p-3.5 text-[15px] leading-snug">
      <p>{n.intro}</p>
      {[n.can, n.cannot].map((g) => (
        <div key={g.title}>
          <p className="font-semibold">{g.title}</p>
          <ul className="mt-1 list-disc space-y-0.5 pl-5">
            {g.items.map((i) => (
              <li key={i}>{i}</li>
            ))}
          </ul>
        </div>
      ))}
      {n.rest.map((r) => (
        <p key={r}>{r}</p>
      ))}
    </div>
  )
}

function GrantSheet({ child, ask, onClose }: { child: Child; ask: boolean; onClose: () => void }) {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [email, setEmail] = useState('')
  const [accepted, setAccepted] = useState(false)
  const [errors, setErrors] = useState<Partial<Record<'username' | 'password' | 'email', string>>>({})
  const grant = useMutation({
    mutationFn: () =>
      api('/me/children/' + child.id + '/access', {
        method: 'POST',
        body: { username: username.trim(), password, ...(ask && email.trim() ? { email: email.trim() } : {}), notice_version: ACCESS_NOTICE_VERSION },
      }),
    onSuccess: async () => {
      toastOk('Acceso propio activado')
      await refresh()
    },
    onError: (err) => {
      const code = errorCode(err)
      const field = fieldOf(code) ?? (err instanceof ApiError && err.field === 'email' ? 'email' : null)
      if (field) setErrors({ [field]: errorText(code) })
      else toastError(err)
      if (code === 'access_exists') void refresh()
    },
  })
  const ready = accepted && username.trim() !== '' && password.length >= 8
  return (
    <FormSheet
      open
      onClose={onClose}
      title="Dar acceso propio"
      description={`${child.display_name} entrará en la app con su usuario y su contraseña.`}
      submitLabel="Activar acceso"
      disabled={!ready}
      loading={grant.isPending}
      onSubmit={() => {
        setErrors({})
        return grant.mutateAsync()
      }}
    >
      <TextField
        label="Usuario"
        value={username}
        onChange={(v) => {
          setUsername(v)
          setErrors({})
        }}
        autoComplete="off"
        autoCapitalize="none"
        spellCheck={false}
        maxLength={30}
        hint="De 3 a 30: minúsculas, números, punto, guion y guion bajo. Sin @."
        error={errors.username}
      />
      <PasswordField label="Contraseña" value={password} onChange={setPassword} error={errors.password} />
      {ask && (
        <TextField
          label="Email (opcional)"
          type="email"
          value={email}
          onChange={setEmail}
          autoComplete="off"
          inputMode="email"
          hint="Le servirá para recibir avisos. La contraseña la sigues cambiando tú."
          error={errors.email}
        />
      )}
      <InfoNotice />
      <label className="flex min-h-11 cursor-pointer items-start gap-3 text-[15px]">
        <Checkbox className="mt-0.5" checked={accepted} onCheckedChange={(c) => setAccepted(c === true)} />
        {ACCESS_NOTICE.accept}
      </label>
    </FormSheet>
  )
}

type Edit = 'password' | 'email'

function EditSheet({ child, access, edit, onClose }: { child: Child; access: ChildAccess; edit: Edit; onClose: () => void }) {
  const [value, setValue] = useState(edit === 'email' ? (access.email ?? '') : '')
  const [error, setError] = useState<string>()
  const save = useMutation({
    mutationFn: () => api(`/me/children/${child.id}/access`, { method: 'PATCH', body: edit === 'password' ? { password: value } : { email: value.trim() || null } }),
    onSuccess: async () => {
      toastOk(edit === 'password' ? 'Contraseña cambiada. Su sesión se ha cerrado.' : 'Email guardado')
      await refresh()
    },
    onError: (err) => {
      const code = errorCode(err)
      if (fieldOf(code)) setError(errorText(code))
      else toastError(err)
    },
  })
  return (
    <FormSheet
      open
      onClose={onClose}
      title={edit === 'password' ? 'Cambiar su contraseña' : 'Cambiar su email'}
      description={
        edit === 'password'
          ? 'Su sesión se cierra y tendrá que entrar con la nueva. Los demás tutores reciben un aviso.'
          : 'Déjalo vacío para quitarlo. Los demás tutores reciben un aviso.'
      }
      submitLabel="Guardar"
      disabled={edit === 'password' && value.length < 8}
      loading={save.isPending}
      onSubmit={() => {
        setError(undefined)
        return save.mutateAsync()
      }}
    >
      {edit === 'password' ? (
        <PasswordField label="Contraseña nueva" value={value} onChange={setValue} error={error} />
      ) : (
        <TextField label="Email" type="email" value={value} onChange={setValue} autoComplete="off" inputMode="email" error={error} />
      )}
    </FormSheet>
  )
}

export function ChildAccessSection({ child }: { child: Child }) {
  const access = child.access ?? null
  const [sheet, setSheet] = useState<'grant' | Edit | null>(null)
  const [revoking, setRevoking] = useState(false)
  // Con la edad de consentimiento (`can_publish`, la decide el servidor) puede tener email; si no, el servidor da email_requires_14.
  const canEmail = !!child.can_publish
  const toggle = useMutation({
    mutationFn: (can_book: boolean) => api(`/me/children/${child.id}/access`, { method: 'PATCH', body: { can_book } }),
    onSuccess: (_, can) => toastOk(can ? 'Ahora puede reservar' : 'Ya no puede reservar'),
    onError: (err) => toastError(err),
    onSettled: refresh,
  })
  const revoke = useMutation({
    mutationFn: () => api(`/me/children/${child.id}/access`, { method: 'DELETE' }),
    onSuccess: () => toastOk('Acceso retirado'),
    onError: (err) => toastError(err),
    onSettled: async () => {
      setRevoking(false)
      await refresh()
    },
  })
  return (
    <section aria-labelledby="own-access" className="flex flex-col gap-3">
      <h2 id="own-access" className="text-lg font-semibold">
        Acceso propio
      </h2>
      {access ? (
        <>
          <div className="rounded-xl border bg-card px-3.5 py-1">
            <Kv rows={[['Usuario', access.username], ...(access.email ? ([['Email', access.email]] as [string, string][]) : [])]} />
          </div>
          <label className="flex min-h-14 items-center justify-between gap-3 rounded-xl border bg-card px-4">
            <span>
              <span className="block font-semibold">Puede reservar</span>
              <span className="block text-sm text-muted-foreground">Reservar y cancelar sesiones y apuntarse a eventos gratuitos.</span>
            </span>
            <Switch checked={access.can_book} disabled={toggle.isPending} onCheckedChange={(c) => toggle.mutate(c)} />
          </label>
          <Button variant="outline" size="xl" onClick={() => setSheet('password')}>
            Cambiar contraseña
          </Button>
          {canEmail && (
            <Button variant="outline" size="xl" onClick={() => setSheet('email')}>
              {access.email ? 'Cambiar email' : 'Añadir email'}
            </Button>
          )}
          <Button variant="outline" size="xl" className="text-destructive-foreground" onClick={() => setRevoking(true)}>
            Retirar el acceso
          </Button>
        </>
      ) : (
        <>
          <p className="text-[15px] text-muted-foreground">Dale un usuario y una contraseña para que entre en la app con su propia cuenta: calendario, progreso y medallas. Tú decides si puede reservar.</p>
          <Button size="xl" onClick={() => setSheet('grant')}>
            Dar acceso propio
          </Button>
        </>
      )}
      {sheet === 'grant' && <GrantSheet child={child} ask={canEmail} onClose={() => setSheet(null)} />}
      {access && (sheet === 'password' || sheet === 'email') && <EditSheet key={sheet} child={child} access={access} edit={sheet} onClose={() => setSheet(null)} />}
      <ConfirmDialog
        open={revoking}
        onOpenChange={(o) => !o && !revoke.isPending && setRevoking(false)}
        title="¿Retirar el acceso?"
        description={`${child.display_name} dejará de poder entrar: su sesión se cierra al momento. Los demás tutores reciben un aviso. Puedes volver a darle acceso cuando quieras.`}
        confirmLabel="Retirar acceso"
        loading={revoke.isPending}
        onConfirm={() => revoke.mutate()}
      />
    </section>
  )
}

// ── Visibilidad pública ──────────────────────────────────────────────────

// Los campos de visible_fields que no son la foto (la foto va aparte).
const FIELDS: [string, string][] = [
  ['bio', 'Presentación'],
  ['social_links', 'Redes'],
  ['disciplines', 'Disciplinas'],
  ['member_since', 'Desde cuándo es alumno'],
  ['achievements', 'Logros'],
  ['ranking', 'Aparecer en los rankings'],
]

type ProfilePatch = { is_public?: boolean; visible_fields?: Record<string, boolean>; social_links?: Record<string, string> | null }
type ProfileOut = { is_public: boolean; visible_fields: Record<string, boolean>; social_links: Record<string, string> | null }

const patchProfile = (id: string, body: ProfilePatch) => api<ProfileOut>(`/me/children/${id}/profile`, { method: 'PATCH', body })

function SocialSheet({ child, onClose }: { child: Child; onClose: () => void }) {
  const [links, setLinks] = useState<Record<string, string>>(child.social_links ?? {})
  const [bad, setBad] = useState<Record<string, boolean>>({})
  const save = useMutation({
    mutationFn: (social: Record<string, string>) => patchProfile(child.id, { social_links: Object.keys(social).length ? social : null }),
    onSuccess: async () => {
      toastOk('Redes guardadas')
      await refresh()
    },
    onError: (err) => toastError(err),
  })
  return (
    <FormSheet
      open
      onClose={onClose}
      title="Redes del perfil"
      description="Enlaces que empiecen por https://. Se ven solo si activas «Redes» en lo que se ve."
      submitLabel="Guardar"
      loading={save.isPending}
      onSubmit={() => {
        const social: Record<string, string> = Object.fromEntries(NETWORKS.map(([k]) => [k, (links[k] ?? '').trim()]).filter(([, u]) => u))
        const wrong = Object.fromEntries(Object.entries(social).map(([k, u]) => [k, !isHttps(u)]))
        setBad(wrong)
        return Object.values(wrong).some(Boolean) ? Promise.reject(new Error('invalid')) : save.mutateAsync(social)
      }}
    >
      {NETWORKS.map(([k, label]) => (
        <TextField
          key={k}
          label={label}
          type="url"
          inputMode="url"
          placeholder="https://"
          value={links[k] ?? ''}
          onChange={(v) => setLinks((l) => ({ ...l, [k]: v }))}
          error={bad[k] ? 'Usa un enlace que empiece por https://' : undefined}
        />
      ))}
    </FormSheet>
  )
}

export function ChildVisibilitySection({ child }: { child: Child }) {
  const [social, setSocial] = useState(false)
  const visible = child.visible_fields ?? {}
  // El servidor mezcla visible_fields con lo que ya había: se manda solo el campo que cambia.
  const set = useMutation({
    mutationFn: (body: ProfilePatch) => patchProfile(child.id, body),
    // La respuesta trae el perfil entero: se pinta ya, sin esperar a recargar la lista.
    onSuccess: (p) =>
      queryClient.setQueryData<Child[]>(['me', 'children'], (list) => list?.map((c) => (c.id === child.id ? { ...c, is_public: p.is_public, visible_fields: p.visible_fields, social_links: p.social_links } : c))),
    onError: (err) => toastError(err),
  })
  const canDecide = !!child.can_publish
  const field = (key: string, label: string) => (
    <label key={key} className="flex min-h-12 items-center justify-between gap-3 border-b last:border-b-0">
      <span className="text-[15px]">{label}</span>
      <Switch checked={visible[key] ?? false} disabled={set.isPending} aria-label={label} onCheckedChange={(c) => set.mutate({ visible_fields: { [key]: c } })} />
    </label>
  )
  return (
    <section aria-labelledby="child-public" className="flex flex-col gap-3">
      <h2 id="child-public" className="text-lg font-semibold">
        Perfil público
      </h2>
      <p className="text-[15px] text-muted-foreground">
        {canDecide
          ? `${child.access ? 'Él o ella también puede decidirlo desde su cuenta.' : 'Puedes decidirlo tú.'} Los demás alumnos lo verían en Comunidad.`
          : 'Hasta que tenga la edad de decidirlo, lo decides tú. Los demás alumnos lo verían en Comunidad.'}
      </p>
      <label className="flex min-h-14 items-center justify-between gap-3 rounded-xl border bg-card px-4">
        <span className="font-semibold">Perfil público</span>
        <Switch checked={child.is_public ?? false} disabled={set.isPending} onCheckedChange={(c) => set.mutate({ is_public: c })} />
      </label>
      <div className="flex flex-col rounded-xl border bg-card px-4 py-1">{field('photo', 'Foto pública')}</div>
      <fieldset className="flex flex-col rounded-xl border bg-card px-4 py-1">
        <legend className="px-1 text-sm font-semibold">Qué se ve</legend>
        {FIELDS.map(([k, l]) => field(k, l))}
      </fieldset>
      <Button variant="outline" size="xl" onClick={() => setSocial(true)}>
        Cambiar sus redes
      </Button>
      {social && <SocialSheet child={child} onClose={() => setSocial(false)} />}
    </section>
  )
}
