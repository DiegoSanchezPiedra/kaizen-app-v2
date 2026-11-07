import { MonitorIcon, MoonIcon, SunIcon } from 'lucide-react'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Menu, MenuPopup, MenuRadioGroup, MenuRadioItem, MenuTrigger } from '@/components/ui/menu'
import { getThemePref, setThemePref, type ThemePref } from '@/lib/theme'
import { cn } from '@/lib/utils'

const OPTIONS: { value: ThemePref; label: string; Icon: typeof SunIcon }[] = [
  { value: 'system', label: 'Como el sistema', Icon: MonitorIcon },
  { value: 'light', label: 'Claro', Icon: SunIcon },
  { value: 'dark', label: 'Oscuro', Icon: MoonIcon },
]

// Botón de tema de la cabecera de cada pantalla (todos los roles) y del acceso.
export function ThemeToggle({ className }: { className?: string }) {
  const [pref, setPref] = useState(getThemePref)
  const current = OPTIONS.find((o) => o.value === pref)!
  return (
    <Menu>
      <MenuTrigger
        render={<Button variant="ghost" size="icon-xl" className={cn('shrink-0 active:not-disabled:scale-[0.96]', className)} aria-label={`Tema: ${current.label}`} />}
      >
        <current.Icon aria-hidden="true" />
      </MenuTrigger>
      <MenuPopup align="end">
        <MenuRadioGroup
          value={pref}
          onValueChange={(v: ThemePref) => {
            setPref(v)
            setThemePref(v)
          }}
        >
          {OPTIONS.map(({ value, label, Icon }) => (
            <MenuRadioItem key={value} value={value} className="min-h-11 gap-2 sm:min-h-9">
              <span className="flex items-center gap-2">
                <Icon aria-hidden="true" />
                {label}
              </span>
            </MenuRadioItem>
          ))}
        </MenuRadioGroup>
      </MenuPopup>
    </Menu>
  )
}
