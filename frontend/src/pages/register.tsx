import { useRef, useState } from 'react'
import { Link } from 'react-router'
import { AuthLayout } from '@/components/auth-layout'
import { PasswordInput } from '@/components/password-input'
import { FieldMessage, NativeMessages, StatusAlert, type Notice } from '@/components/status-alert'
import { Button } from '@/components/ui/button'
import { Field, FieldDescription, FieldLabel } from '@/components/ui/field'
import { Form } from '@/components/ui/form'
import { Input } from '@/components/ui/input'
import { InputGroup, InputGroupInput } from '@/components/ui/input-group'
import { ApiError, api } from '@/lib/api'
import { errorText } from '@/lib/errors'
import { maskSpanishDate, parseSpanishDate } from '@/lib/format'
import { setToken } from '@/lib/session'

// Qué campo señala cada code de POST /auth/register.
const FIELD_OF: Record<string, string> = {
  email_taken: 'email',
  email_domain_reserved: 'email',
  weak_password: 'password',
  invalid_birth_date: 'birthDate',
}

export function RegisterPage() {
  const [birth, setBirth] = useState('')
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [notice, setNotice] = useState<Notice | null>(null)
  // Menor: el aviso va arriba pero habla de la fecha de nacimiento, así que se enlaza con ese campo.
  const [minor, setMinor] = useState(false)
  const [loading, setLoading] = useState(false)
  // Teclado: con puntero táctil, el foco inicial abriría el teclado y taparía la pantalla.
  const [fine] = useState(() => window.matchMedia('(pointer: fine)').matches)
  const form = useRef<HTMLFormElement>(null)
  // Con un error en un campo, el foco va a él: el lector lo anuncia y el teclado queda donde hay que corregir.
  const focus = (field: string) => form.current?.querySelector<HTMLElement>(`[name="${field}"]`)?.focus()

  async function submit(v: Record<string, unknown>) {
    setNotice(null)
    setMinor(false)
    const birthDate = parseSpanishDate(birth)
    if (!birthDate) {
      setErrors({ birthDate: errorText('invalid_birth_date') })
      return focus('birthDate')
    }
    setErrors({})
    setLoading(true)
    try {
      const res = await api<{ token: string }>('/auth/register', {
        method: 'POST',
        auth: false,
        body: { displayName: v.displayName, email: v.email, password: v.password, birthDate },
      })
      setToken(res.token) // PublicOnly lleva al inicio
    } catch (err) {
      const code = err instanceof ApiError ? err.code : 'unknown'
      const field = FIELD_OF[code] ?? (err instanceof ApiError ? err.field : undefined)
      if (field) {
        setErrors({ [field]: errorText(code) })
        focus(field)
      } else if (code === 'minor_cannot_register') {
        setMinor(true)
        setNotice({
          kind: 'warning',
          title: 'Un menor lo da de alta su padre, madre o tutor',
          text: 'Si lo eres, crea tu cuenta y añade después a tu hijo o hija.',
        })
      } else setNotice({ kind: code === 'network' ? 'warning' : 'error', icon: code === 'network' ? 'wifi' : undefined, title: errorText(code) })
    } finally {
      setLoading(false)
    }
  }

  return (
    <AuthLayout>
      <div className="flex flex-col gap-1.5">
        <h1 className="font-heading text-[34px] font-bold leading-tight">Crear cuenta</h1>
        <p className="text-sm text-muted-foreground">
          Para mayores de edad. A un menor lo da de alta su padre, madre o tutor desde su propia cuenta.
        </p>
      </div>
      {notice && <StatusAlert notice={notice} id={minor ? 'register-notice' : undefined} />}
      <Form ref={form} className="flex flex-col gap-4" errors={errors} onFormSubmit={submit}>
        <Field name="displayName" className="items-stretch">
          <FieldLabel>Nombre y apellidos</FieldLabel>
          <Input autoComplete="name" autoCapitalize="words" enterKeyHint="next" required autoFocus={fine} />
          <NativeMessages />
        </Field>
        <Field name="email" className="items-stretch">
          <FieldLabel>Email</FieldLabel>
          <Input type="email" autoComplete="email" inputMode="email" autoCapitalize="none" spellCheck={false} enterKeyHint="next" required />
          <NativeMessages email />
          {errors.email && (
            <FieldMessage>
              {errors.email}{' '}
              <Link to="/login" className="font-semibold text-link underline underline-offset-3">
                Entrar
              </Link>
            </FieldMessage>
          )}
        </Field>
        <Field name="password" className="items-stretch">
          <FieldLabel>Contraseña</FieldLabel>
          <PasswordInput autoComplete="new-password" enterKeyHint="next" required minLength={8} />
          <NativeMessages minLength />
          {errors.password ? <FieldMessage>{errors.password}</FieldMessage> : <FieldDescription>Mínimo 8 caracteres.</FieldDescription>}
        </Field>
        <Field name="birthDate" className="items-stretch" invalid={minor || undefined}>
          <FieldLabel>Fecha de nacimiento</FieldLabel>
          <InputGroup>
            <InputGroupInput
              inputMode="numeric"
              autoComplete="bday"
              enterKeyHint="go"
              // Marcador al 100 %: al 72 % del Input no llega a 4,5:1 (excepción acotada a las pantallas de entrada).
              className="**:placeholder:text-muted-foreground!"
              placeholder="dd/mm/aaaa"
              maxLength={10}
              value={birth}
              onChange={(e) => {
                setBirth(maskSpanishDate(e.target.value))
                setMinor(false)
              }}
              aria-describedby={minor ? 'register-notice' : undefined}
              required
            />
          </InputGroup>
          <NativeMessages />
          {errors.birthDate && <FieldMessage>{errors.birthDate}</FieldMessage>}
        </Field>
        <Button type="submit" size="xl" className="w-full" loading={loading}>
          Crear cuenta
        </Button>
      </Form>
      <p className="flex items-center justify-center gap-1.5 text-sm text-muted-foreground">
        ¿Ya tienes cuenta?
        <Link to="/login" className="inline-flex min-h-11 items-center font-semibold text-link underline underline-offset-3">
          Entrar
        </Link>
      </p>
    </AuthLayout>
  )
}
