import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from '@/components/ui/select'

export function Filter({ label, value, onChange, items }: { label: string; value: string; onChange: (v: string) => void; items: { value: string; label: string }[] }) {
  return (
    <Select value={value} onValueChange={(v) => v && onChange(v)} items={items}>
      <SelectTrigger aria-label={label} className="min-h-11 sm:min-h-11">
        <SelectValue />
      </SelectTrigger>
      <SelectPopup>
        {items.map((i) => (
          <SelectItem key={i.value} value={i.value} className="min-h-11 sm:min-h-11">
            {i.label}
          </SelectItem>
        ))}
      </SelectPopup>
    </Select>
  )
}
