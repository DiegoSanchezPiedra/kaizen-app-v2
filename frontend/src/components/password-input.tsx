import { EyeIcon, EyeOffIcon } from 'lucide-react'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { InputGroup, InputGroupAddon, InputGroupInput } from '@/components/ui/input-group'
import type { InputProps } from '@/components/ui/input'

export function PasswordInput(props: Omit<InputProps, 'type'>) {
  const [visible, setVisible] = useState(false)
  return (
    <InputGroup>
      <InputGroupInput {...props} type={visible ? 'text' : 'password'} />
      <InputGroupAddon align="inline-end">
        <Button
          variant="ghost"
          size="icon-sm"
          className="after:absolute after:-inset-1.5 pointer-fine:after:-inset-2" // zona de 44 px (con dedo 32 + 12, con ratón 28 + 16) sin cambiar el tamaño visible
          aria-label={visible ? 'Ocultar contraseña' : 'Mostrar contraseña'}
          aria-pressed={visible}
          onClick={() => setVisible((v) => !v)}
        >
          {visible ? <EyeOffIcon /> : <EyeIcon />}
        </Button>
      </InputGroupAddon>
    </InputGroup>
  )
}
