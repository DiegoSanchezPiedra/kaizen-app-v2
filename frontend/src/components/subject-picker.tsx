import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from '@/components/ui/select'
import { useSubject } from '@/hooks/use-subject'

// Fijo arriba en las pantallas que actúan por un sujeto; sin hijos vigentes, no se pinta.
export function SubjectPicker() {
  const { options, subject, select } = useSubject()
  if (!subject) return null
  return (
    <div className="sticky top-0 z-10 -mx-4 -mt-6 mb-4 flex items-center gap-3 border-b bg-background/95 px-4 py-2 backdrop-blur lg:-mx-10 lg:px-10">
      <span id="subject-label" className="text-sm font-semibold text-muted-foreground">
        Para
      </span>
      <Select
        value={subject.id}
        onValueChange={(id) => id && select(id)}
        items={options.map((o) => ({ value: o.id, label: o.label }))}
      >
        <SelectTrigger aria-labelledby="subject-label" className="min-h-11 max-w-64 sm:min-h-11">
          <SelectValue />
        </SelectTrigger>
        <SelectPopup>
          {options.map((o) => (
            <SelectItem key={o.id} value={o.id} className="min-h-11 sm:min-h-11">
              {o.label}
            </SelectItem>
          ))}
        </SelectPopup>
      </Select>
    </div>
  )
}
