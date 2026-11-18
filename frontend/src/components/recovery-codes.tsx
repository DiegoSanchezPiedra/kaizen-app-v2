import { CopyIcon, DownloadIcon } from 'lucide-react'
import { useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { toastOk } from '@/lib/notify'

// Los códigos de recuperación del MFA, que solo se ven una vez (al activarlo y al generar otros): lista, copiar y descargar.
// Llegan por props desde un estado de la página: nunca pasan por React Query ni por el almacenamiento.
export function RecoveryCodes({ codes }: { codes: string[] }) {
  const list = useRef<HTMLOListElement>(null)
  const [manualCopy, setManualCopy] = useState(false)
  const text = codes.join('\n')
  const copy = () =>
    Promise.resolve()
      .then(() => navigator.clipboard.writeText(text))
      .then(
        () => toastOk('Códigos copiados'),
        () => {
          // Sin permiso o sin HTTPS: se dejan seleccionados para copiarlos a mano.
          if (list.current) window.getSelection()?.selectAllChildren(list.current)
          setManualCopy(true)
        },
      )
  const download = () => {
    const a = document.createElement('a')
    a.href = URL.createObjectURL(new Blob([`Códigos de recuperación de Kaizen (cada uno sirve una vez)\n\n${text}\n`], { type: 'text/plain' }))
    a.download = 'kaizen-codigos-de-recuperacion.txt'
    a.click()
    URL.revokeObjectURL(a.href)
  }
  return (
    <div className="flex flex-col gap-2">
      <ol ref={list} aria-label="Códigos de recuperación" className="grid grid-cols-2 gap-x-6 gap-y-1.5 rounded-xl bg-muted px-4 py-3 font-mono text-[15px] tracking-wide">
        {codes.map((c) => (
          <li key={c}>{c}</li>
        ))}
      </ol>
      <div className="grid grid-cols-2 gap-2 sm:flex">
        <Button variant="outline" className="h-11 sm:h-11" onClick={() => void copy()}>
          <CopyIcon />
          Copiar
        </Button>
        <Button variant="outline" className="h-11 sm:h-11" onClick={download}>
          <DownloadIcon />
          Descargar .txt
        </Button>
      </div>
      {manualCopy && (
        <p role="status" className="text-sm text-muted-foreground">
          No se han podido copiar solos: ya están seleccionados, cópialos con el menú o el teclado.
        </p>
      )}
    </div>
  )
}
