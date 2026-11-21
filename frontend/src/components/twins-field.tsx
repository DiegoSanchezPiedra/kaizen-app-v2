import { Checkbox } from '@/components/ui/checkbox'

export type Twin = { id: string; discipline_name: string }

export const twinNames = (twins: Twin[]) => new Intl.ListFormat('es', { type: 'conjunction' }).format(twins.map((t) => t.discipline_name))

// ADR 0034: una clase o sesión con otra simultánea (mismo profesor, hora, duración y lugar) solo se mueve con ella.
export function TwinsField({ twins, checked, onChange }: { twins: Twin[]; checked: boolean; onChange: (v: boolean) => void }) {
  if (twins.length === 0) return null
  return (
    <label className="flex min-h-11 items-start gap-3 rounded-lg border px-3 py-2.5">
      <Checkbox className="mt-0.5" checked={checked} onCheckedChange={(v) => onChange(v === true)} />
      <span className="flex flex-col gap-0.5">
        <span className="text-sm font-medium">Cambiar también {twinNames(twins)}</span>
        <span className="text-xs text-pretty text-muted-foreground">Va a la vez, con el mismo profesor y lugar. Se lleva la hora, la duración y el lugar; el profesor y el aforo, no.</span>
      </span>
    </label>
  )
}
