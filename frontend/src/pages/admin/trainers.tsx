import { useMutation } from '@tanstack/react-query'
import { BanIcon, CheckIcon, CircleCheckIcon, CopyIcon, LinkIcon, MailIcon, PlusIcon, type LucideIcon } from 'lucide-react'
import { useRef, useState } from 'react'
import { useNavigate } from 'react-router'
import { Tag } from '@/components/billing-bits'
import { ConfirmDialog } from '@/components/confirm-dialog'
import { Filter } from '@/components/filter'
import { Button } from '@/components/ui/button'
import { Dialog, DialogDescription, DialogFooter, DialogHeader, DialogPanel, DialogPopup, DialogTitle } from '@/components/ui/dialog'
import { ROLE_LABEL, TRAINER_STATE, trainerState, type ProfileFile, type TrainerState } from '@/lib/admin'
import { ApiError, api } from '@/lib/api'
import { EMPLOYMENT_LABEL, type Employment } from '@/lib/clock'
import { madridDay } from '@/lib/dates'
import { errorText } from '@/lib/errors'
import { queryClient } from '@/lib/logout'
import { toastError, toastOk } from '@/lib/notify'
import type { Role } from '@/lib/paths'
import { FormSheet, SelectField, TextField, useFieldError } from '@/pages/admin/schedule-bits'
import { post, useConfirm } from '@/pages/admin/user-billing'

// Alta, edición y baja de profesores (ADR 0028). El correo corporativo lo crea el admin en el proveedor; aquí solo se registra.
const EMAIL_CODES = ['email_domain_not_allowed', 'email_domain_reserved', 'email_taken', 'same_email']
const refreshAll = () => void queryClient.invalidateQueries({ queryKey: ['admin'] })
const EMPLOYMENT_ITEMS = (Object.keys(EMPLOYMENT_LABEL) as Employment[]).map((value) => ({ value, label: EMPLOYMENT_LABEL[value] }))

// Los fallos del correo salen bajo su campo; el resto, como en los demás formularios del panel.
function useTrainerErrors() {
  const [emailError, setEmailError] = useState<string>()
  const f = useFieldError()
  return {
    emailError,
    field: f.error,
    clear: () => {
      setEmailError(undefined)
      f.clear()
    },
    fail: (err: unknown) => (err instanceof ApiError && EMAIL_CODES.includes(err.code ?? '') ? setEmailError(errorText(err.code)) : f.fail(err)),
  }
}

const EMAIL_HINT = 'El correo corporativo, ya creado en el proveedor. Recibirá aquí el enlace para elegir su contraseña.'

const ROLE_ITEMS = (['alumno', 'tutor', 'profesor', 'admin'] as const).map((value) => ({ value, label: ROLE_LABEL[value] }))
const ROLE_HINT: Record<Role, string> = {
  alumno: 'Un adulto que entrena. A los menores los da de alta su tutor desde su app.',
  tutor: 'Podrá dar de alta a sus hijos desde su app.',
  profesor: 'Entra con el correo corporativo de la academia.',
  admin: 'Podrá hacer todo lo que haces tú, y desde la app no se le podrá quitar.',
}
export type InviteLink = { id: string; name: string; url: string }

// Alta de cualquier usuario (ADR 0032; el profesor, por /admin/trainers, ADR 0028). Sin contraseña: un enlace de un solo uso
// que llega por email y que el admin también puede copiar y pasar a mano.
export function NewUser() {
  const [open, setOpen] = useState(false)
  const [role, setRole] = useState<Role>('alumno')
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [birth, setBirth] = useState('')
  const [birthError, setBirthError] = useState<string>()
  const [employment, setEmployment] = useState<Employment>('self_employed')
  const [link, setLink] = useState<InviteLink | null>(null)
  const errors = useTrainerErrors()
  const trainer = role === 'profesor'
  const needsBirth = role === 'alumno' || role === 'tutor'
  const clear = () => {
    errors.clear()
    setBirthError(undefined)
  }
  const close = () => {
    setOpen(false)
    setRole('alumno')
    setName('')
    setEmail('')
    setBirth('')
    setEmployment('self_employed')
    clear()
  }
  const submit = () => {
    const base = { display_name: name.trim(), email: email.trim() }
    const req = trainer
      ? api<{ trainer: { id: string }; invite_url: string }>('/admin/trainers', { method: 'POST', body: { ...base, employment } }).then((r) => ({ id: r.trainer.id, url: r.invite_url }))
      : api<{ profile: { id: string }; invite_url: string }>('/admin/users', { method: 'POST', body: { ...base, role, ...(needsBirth && { birth_date: birth }) } }).then((r) => ({ id: r.profile.id, url: r.invite_url }))
    return req.then(
      (r) => {
        setLink({ ...r, name: base.display_name })
        close()
        refreshAll()
      },
      (err) => {
        if (err instanceof ApiError && err.code === 'invalid_birth_date') setBirthError(errorText(err.code))
        else errors.fail(err)
        throw err
      },
    )
  }
  return (
    <>
      <Button variant="outline" size="lg" className="max-sm:h-11" onClick={() => setOpen(true)}>
        <PlusIcon aria-hidden="true" />
        Nuevo usuario
      </Button>
      <FormSheet
        open={open}
        onClose={close}
        title="Nuevo usuario"
        description="Le daremos un enlace de un solo uso, válido 72 horas, para elegir su contraseña."
        submitLabel="Dar de alta"
        disabled={!name.trim() || !email.trim() || (needsBirth && !birth)}
        onSubmit={submit}
      >
        <SelectField label="Rol">
          <Filter label="Rol" value={role} onChange={(v) => { setRole(v as Role); clear() }} items={ROLE_ITEMS} />
          <p className="text-xs text-muted-foreground">{ROLE_HINT[role]}</p>
        </SelectField>
        <TextField label="Nombre" value={name} onChange={(v) => { setName(v); clear() }} autoComplete="off" required error={errors.field('display_name')} />
        <TextField
          label={trainer ? 'Correo corporativo' : 'Email'}
          type="email"
          inputMode="email"
          value={email}
          onChange={(v) => { setEmail(v); clear() }}
          autoComplete="off"
          required
          hint={trainer ? EMAIL_HINT : undefined}
          error={errors.emailError ?? errors.field('email')}
        />
        {needsBirth && (
          <TextField label="Fecha de nacimiento" type="date" value={birth} onChange={(v) => { setBirth(v); clear() }} max={madridDay()} required hint="Solo adultos." error={birthError} />
        )}
        {trainer && (
          <SelectField label="Tipo de relación">
            <Filter label="Tipo de relación" value={employment} onChange={(v) => setEmployment(v as Employment)} items={EMPLOYMENT_ITEMS} />
          </SelectField>
        )}
      </FormSheet>
      <InviteLinkDialog link={link} onClose={() => setLink(null)} showFile />
    </>
  )
}

// El enlace solo se ve aquí: «Copiar» para pasarlo por WhatsApp o en mano; sin portapapeles, queda seleccionado (como en Tablets).
export function InviteLinkDialog({ link, onClose, showFile }: { link: InviteLink | null; onClose: () => void; showFile?: boolean }) {
  const navigate = useNavigate()
  const [copied, setCopied] = useState(false)
  const [manual, setManual] = useState(false)
  const urlRef = useRef<HTMLParagraphElement>(null)
  const done = () => {
    setCopied(false)
    setManual(false)
    onClose()
  }
  const copy = () =>
    (navigator.clipboard?.writeText(link!.url) ?? Promise.reject(new Error('no clipboard'))).then(
      () => {
        toastOk('Enlace copiado')
        setCopied(true)
      },
      () => {
        setManual(true)
        if (urlRef.current) window.getSelection()?.selectAllChildren(urlRef.current)
      },
    )
  return (
    <Dialog open={link !== null} onOpenChange={(o) => !o && done()}>
      {link && (
        <DialogPopup closeProps={{ 'aria-label': 'Cerrar' }}>
          <DialogHeader>
            <DialogTitle>Enlace para {link.name}</DialogTitle>
            <DialogDescription>Pásaselo por WhatsApp o en mano. Vale 72 horas y una sola vez; con él elige su contraseña y entra.</DialogDescription>
          </DialogHeader>
          <DialogPanel className="flex flex-col gap-3">
            <p ref={urlRef} aria-label="Enlace de invitación" className="rounded-xl border bg-muted px-3 py-3 font-mono text-sm break-all select-all">
              {link.url}
            </p>
            <Button variant="outline" size="lg" className="h-11 self-center sm:h-11" onClick={() => void copy()}>
              {copied ? <CheckIcon aria-hidden="true" /> : <CopyIcon aria-hidden="true" />}
              {copied ? 'Copiado' : 'Copiar enlace'}
            </Button>
            {manual && (
              <p role="status" className="text-center text-sm text-muted-foreground">
                No se ha podido copiar: el enlace está seleccionado, cópialo a mano.
              </p>
            )}
            <p className="text-sm text-muted-foreground">También se envía a su email. Si lo pierde, crea otro desde su ficha: el anterior dejará de valer.</p>
          </DialogPanel>
          <DialogFooter>
            {showFile && (
              <Button variant="outline" size="xl" className="h-11 sm:h-11" onClick={() => { done(); navigate(`/admin/users/${link.id}`) }}>
                Ver ficha
              </Button>
            )}
            <Button size="xl" className="h-11 sm:h-11" onClick={done}>
              Hecho
            </Button>
          </DialogFooter>
        </DialogPopup>
      )}
    </Dialog>
  )
}

// «Nuevo enlace» para quien aún no ha entrado: invalida el anterior, así que se confirma.
export function NewInviteLink({ id, name, endpoint, refresh }: { id: string; name: string; endpoint: string; refresh: () => void }) {
  const [asking, setAsking] = useState(false)
  const [link, setLink] = useState<InviteLink | null>(null)
  const create = useMutation({
    mutationFn: () => api<{ invite_url: string }>(endpoint, { method: 'POST' }),
    onSuccess: (r) => setLink({ id, name, url: r.invite_url }),
    onError: (err) => toastError(err),
    onSettled: () => {
      setAsking(false)
      refresh()
    },
  })
  return (
    <>
      <Button variant="outline" size="lg" className="max-sm:h-11" onClick={() => setAsking(true)}>
        <LinkIcon aria-hidden="true" />
        Nuevo enlace
      </Button>
      <ConfirmDialog
        open={asking}
        onOpenChange={(o) => !o && !create.isPending && setAsking(false)}
        title="¿Crear un enlace nuevo?"
        description="El anterior dejará de valer. También le llegará por email."
        confirmLabel="Crear enlace"
        variant="default"
        loading={create.isPending}
        onConfirm={() => create.mutate()}
      />
      <InviteLinkDialog link={link} onClose={() => setLink(null)} />
    </>
  )
}

function EditTrainer({ p, open, onClose }: { p: ProfileFile['profile']; open: boolean; onClose: () => void }) {
  const [name, setName] = useState(p.display_name ?? '')
  const [email, setEmail] = useState(p.email ?? '')
  const errors = useTrainerErrors()
  const emailChanged = email.trim().toLowerCase() !== (p.email ?? '').toLowerCase()
  const nameChanged = name.trim() !== (p.display_name ?? '')
  const submit = () =>
    api(`/admin/trainers/${p.id}`, { method: 'PATCH', body: { ...(nameChanged && { display_name: name.trim() }), ...(emailChanged && { email: email.trim() }) } }).then(
      () => {
        toastOk(emailChanged ? 'Correo cambiado e invitación enviada' : 'Cambios guardados')
        refreshAll()
      },
      (err) => {
        errors.fail(err)
        throw err
      },
    )
  return (
    <FormSheet
      open={open}
      onClose={onClose}
      title="Editar profesor"
      description="Conserva su historial: clases, sesiones y jornada."
      submitLabel="Guardar"
      disabled={!name.trim() || !email.trim() || (!nameChanged && !emailChanged)}
      confirm={emailChanged ? { title: '¿Cambiar el correo?', description: 'Se anulan su contraseña y sus sesiones abiertas, y recibirá una invitación nueva en el correo nuevo.', destructive: true } : undefined}
      onSubmit={submit}
    >
      <TextField label="Nombre" value={name} onChange={(v) => { setName(v); errors.clear() }} autoComplete="off" required error={errors.field('display_name')} />
      <TextField label="Correo corporativo" type="email" inputMode="email" value={email} onChange={(v) => { setEmail(v); errors.clear() }} autoComplete="off" required hint={EMAIL_HINT} error={errors.emailError ?? errors.field('email')} />
    </FormSheet>
  )
}

// En la ficha de un profesor: estado y acciones (reenviar la invitación, editar, desactivar o reactivar).
const TRAINER_ICON: Record<TrainerState, LucideIcon> = { active: CircleCheckIcon, pending: MailIcon, disabled: BanIcon }
// Estado de la cuenta del profesor con icono y texto (lista y ficha de Usuarios).
export function TrainerTag({ state }: { state: TrainerState }) {
  const [label, variant] = TRAINER_STATE[state]
  const Icon = TRAINER_ICON[state]
  return (
    <Tag variant={variant}>
      <Icon aria-hidden="true" />
      {label}
    </Tag>
  )
}

export function TrainerActions({ file, refresh }: { file: ProfileFile; refresh: () => void }) {
  const p = file.profile
  const state = trainerState(p)
  const [editing, setEditing] = useState(false)
  const { ask, dialog } = useConfirm(refresh)
  return (
    <div className="flex flex-col gap-3 border-t pt-3">
      <div className="flex items-center gap-2">
        <span className="text-sm text-muted-foreground sm:w-40">Cuenta</span>
        <TrainerTag state={state} />
      </div>
      <div className="flex flex-wrap gap-2">
        {state === 'pending' && <NewInviteLink id={p.id} name={p.display_name ?? ''} endpoint={`/admin/trainers/${p.id}/invite`} refresh={refresh} />}
        <Button variant="outline" size="lg" onClick={() => setEditing(true)}>
          Editar
        </Button>
        {state === 'disabled' ? (
          <Button
            variant="outline"
            size="lg"
            onClick={() =>
              ask({ title: '¿Reactivar a este profesor?', description: 'Podrá volver a entrar con su contraseña.', label: 'Reactivar', done: 'Profesor reactivado', run: post(`/admin/trainers/${p.id}/reactivate`) })
            }
          >
            Reactivar
          </Button>
        ) : (
          <Button
            variant="outline"
            size="lg"
            onClick={() =>
              ask({
                title: '¿Desactivar a este profesor?',
                description: 'No podrá entrar y su sesión se cierra al momento. Se conserva su historial. Antes hay que reasignar sus clases y sesiones futuras.',
                label: 'Desactivar',
                done: 'Profesor desactivado',
                destructive: true,
                run: post(`/admin/trainers/${p.id}/deactivate`),
              })
            }
          >
            Desactivar
          </Button>
        )}
      </div>
      {editing && <EditTrainer p={p} open onClose={() => setEditing(false)} />}
      {dialog}
    </div>
  )
}
