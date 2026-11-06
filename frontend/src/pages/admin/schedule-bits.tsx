import { useQuery } from '@tanstack/react-query'
import { useId, useState } from 'react'
import type React from 'react'
import { ConfirmDialog } from '@/components/confirm-dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Sheet, SheetDescription, SheetFooter, SheetHeader, SheetPanel, SheetPopup, SheetTitle } from '@/components/ui/sheet'
import type { Paged, ProfileRow } from '@/lib/admin'
import { Switch } from '@/components/ui/switch'
import { api, ApiError } from '@/lib/api'
import { toastError } from '@/lib/notify'
import type { Discipline } from '@/lib/types'
import { path } from '@/lib/url'

// Todas las disciplinas (también las desactivadas) y los profesores: lo que piden los formularios del horario.
export const useAdminDisciplines = () =>
  useQuery({ queryKey: ['admin', 'disciplines'], queryFn: () => api<{ disciplines: Discipline[] }>('/admin/disciplines').then((r) => r.disciplines) })
export const useTrainers = () =>
  useQuery({
    queryKey: ['admin', 'profiles', 'trainers'],
    queryFn: () => api<Paged<'profiles', ProfileRow>>(path('/admin/profiles', { role: 'profesor', limit: '100' })).then((r) => r.profiles),
  })

export function TextField({
  label,
  value,
  onChange,
  type = 'text',
  hint,
  error,
  ...rest
}: { label: string; value: string; onChange: (v: string) => void; type?: string; hint?: string; error?: string } & Omit<React.ComponentProps<'input'>, 'value' | 'onChange' | 'size'>) {
  const id = useId()
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-sm font-medium">
        {label}
      </label>
      <Input id={id} type={type} value={value} size="lg" onChange={(e) => onChange(e.target.value)} aria-invalid={error ? true : undefined} {...rest} />
      {error ? (
        <p role="alert" className="text-xs text-destructive-foreground">
          {error}
        </p>
      ) : (
        hint && <p className="text-xs text-muted-foreground">{hint}</p>
      )}
    </div>
  )
}

export function SelectField({ label, error, children }: { label: string; error?: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-sm font-medium">{label}</span>
      {children}
      {error && (
        <p role="alert" className="text-xs text-destructive-foreground">
          {error}
        </p>
      )}
    </div>
  )
}

// Hoja con un formulario. Si la acción avisa a alguien (`confirm`), «Guardar» abre antes un AlertDialog que lo dice.
export function FormSheet({
  open,
  onClose,
  title,
  description,
  submitLabel,
  disabled,
  loading,
  confirm,
  onSubmit,
  children,
}: {
  open: boolean
  onClose: () => void
  title: string
  description: string
  submitLabel: string
  disabled?: boolean
  loading?: boolean
  confirm?: { title: string; description: string; destructive?: boolean }
  // Lo que pasa al guardar. Si falla, la hoja se queda abierta para corregir; el aviso del error lo da quien llama.
  onSubmit: () => Promise<unknown>
  children: React.ReactNode
}) {
  const [asking, setAsking] = useState(false)
  const run = () => onSubmit().then(onClose, () => {}).finally(() => setAsking(false))
  return (
    <Sheet open={open} onOpenChange={(o) => !o && !loading && onClose()}>
      <SheetPopup closeProps={{ 'aria-label': 'Cerrar' }}>
        <form
          className="flex min-h-0 flex-1 flex-col"
          onSubmit={(e) => {
            e.preventDefault()
            if (disabled || loading) return
            if (confirm) setAsking(true)
            else void run()
          }}
        >
          <SheetHeader>
            <SheetTitle>{title}</SheetTitle>
            <SheetDescription>{description}</SheetDescription>
          </SheetHeader>
          <SheetPanel>
            <div className="flex flex-col gap-4">{children}</div>
          </SheetPanel>
          <SheetFooter>
            <Button type="button" variant="outline" size="xl" disabled={loading} onClick={onClose}>
              Cancelar
            </Button>
            <Button type="submit" size="xl" disabled={disabled} loading={loading && !confirm}>
              {submitLabel}
            </Button>
          </SheetFooter>
        </form>
      </SheetPopup>
      {confirm && (
        <ConfirmDialog
          open={asking}
          onOpenChange={(o) => !o && !loading && setAsking(false)}
          title={confirm.title}
          description={confirm.description}
          confirmLabel={submitLabel}
          variant={confirm.destructive ? 'destructive' : 'default'}
          loading={loading}
          onConfirm={() => void run()}
        />
      )}
    </Sheet>
  )
}

// Un interruptor con su explicación, en una fila táctil.
export function SwitchRow({ label, hint, checked, onChange }: { label: string; hint?: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex min-h-12 items-center justify-between gap-3 rounded-xl border bg-card px-4 py-2">
      <span>
        <span className="block text-[15px] font-medium">{label}</span>
        {hint && <span className="block text-xs text-muted-foreground">{hint}</span>}
      </span>
      <Switch checked={checked} onCheckedChange={onChange} />
    </label>
  )
}

// `invalid_field` trae su campo: el aviso sale bajo ese campo. Cualquier otro error, en un toast.
export function useFieldError() {
  const [field, setField] = useState<string | null>(null)
  return {
    error: (name: string) => (field === name ? 'Revisa este valor.' : undefined),
    clear: () => setField(null),
    fail: (err: unknown) => (err instanceof ApiError && err.code === 'invalid_field' && err.field ? setField(err.field) : toastError(err)),
  }
}
