import { PlusIcon } from 'lucide-react'
import { useState } from 'react'
import { useNavigate } from 'react-router'
import { Tag } from '@/components/billing-bits'
import { Filter } from '@/components/filter'
import { Button } from '@/components/ui/button'
import { TRAINER_STATE, trainerState, type ProfileFile } from '@/lib/admin'
import { ApiError, api } from '@/lib/api'
import { EMPLOYMENT_LABEL, type Employment } from '@/lib/clock'
import { errorText } from '@/lib/errors'
import { queryClient } from '@/lib/logout'
import { toastOk } from '@/lib/notify'
import { FormSheet, SelectField, TextField, useFieldError } from '@/pages/admin/schedule-bits'
import { post, useConfirm } from '@/pages/admin/user-billing'

// Alta, edición y baja de profesores (ADR 0028). El correo corporativo lo crea el admin en el proveedor; aquí solo se registra.
const EMAIL_CODES = ['email_domain_not_allowed', 'email_taken', 'same_email']
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

export function NewTrainer() {
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [employment, setEmployment] = useState<Employment>('self_employed')
  const errors = useTrainerErrors()
  const navigate = useNavigate()
  const close = () => {
    setOpen(false)
    setName('')
    setEmail('')
    setEmployment('self_employed')
    errors.clear()
  }
  const submit = () =>
    api<{ trainer: { id: string } }>('/admin/trainers', { method: 'POST', body: { display_name: name.trim(), email: email.trim(), employment } }).then(
      (r) => {
        toastOk('Invitación enviada')
        refreshAll()
        navigate(`/admin/users/${r.trainer.id}`)
      },
      (err) => {
        errors.fail(err)
        throw err
      },
    )
  return (
    <>
      <Button variant="outline" size="lg" className="w-full sm:w-auto" onClick={() => setOpen(true)}>
        <PlusIcon aria-hidden="true" />
        Nuevo profesor
      </Button>
      <FormSheet
        open={open}
        onClose={close}
        title="Nuevo profesor"
        description="Recibirá un enlace de un solo uso, válido 72 horas, para elegir su contraseña."
        submitLabel="Dar de alta"
        disabled={!name.trim() || !email.trim()}
        onSubmit={submit}
      >
        <TextField label="Nombre" value={name} onChange={(v) => { setName(v); errors.clear() }} autoComplete="off" required error={errors.field('display_name')} />
        <TextField label="Correo corporativo" type="email" inputMode="email" value={email} onChange={(v) => { setEmail(v); errors.clear() }} autoComplete="off" required hint={EMAIL_HINT} error={errors.emailError ?? errors.field('email')} />
        <SelectField label="Tipo de relación">
          <Filter label="Tipo de relación" value={employment} onChange={(v) => setEmployment(v as Employment)} items={EMPLOYMENT_ITEMS} />
        </SelectField>
      </FormSheet>
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
export function TrainerActions({ file, refresh }: { file: ProfileFile; refresh: () => void }) {
  const p = file.profile
  const state = trainerState(p)
  const [editing, setEditing] = useState(false)
  const { ask, dialog } = useConfirm(refresh)
  const [label, variant] = TRAINER_STATE[state]
  return (
    <div className="flex flex-col gap-3 border-t pt-3">
      <div className="flex items-center gap-2">
        <span className="text-sm text-muted-foreground sm:w-40">Cuenta</span>
        <Tag variant={variant}>{label}</Tag>
      </div>
      <div className="flex flex-wrap gap-2">
        {state === 'pending' && (
          <Button
            variant="outline"
            size="lg"
            onClick={() =>
              ask({ title: 'Reenviar la invitación', description: 'Recibirá un enlace nuevo y el anterior dejará de valer.', label: 'Reenviar', done: 'Invitación enviada', run: post(`/admin/trainers/${p.id}/invite`) })
            }
          >
            Reenviar invitación
          </Button>
        )}
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
