import { useEffect, useState } from 'react'
import type { HomeNotice } from '@/lib/notices'

export type StepRow = { n: HomeNotice; leaving: boolean }

// Un aviso que se resuelve con el Inicio abierto (se refresca la cuota o el perfil) no se corta: la fila se pliega
// 200 ms y se va. Devuelve las filas con las que salen marcadas; si no queda ninguna, el padre no pinta la tarjeta.
export function useStepRows(notices: HomeNotice[]): StepRow[] {
  const key = notices.map((n) => n.id).join()
  const [seen, setSeen] = useState(key)
  const [rows, setRows] = useState<StepRow[]>(() => notices.map((n) => ({ n, leaving: false })))
  if (key !== seen) {
    // Se deriva durante el render (patrón de React): así la fila que sale no llega a desmontarse antes de plegarse.
    setSeen(key)
    const next: StepRow[] = notices.map((n) => ({ n, leaving: false }))
    rows.forEach((r, i) => {
      if (!notices.some((n) => n.id === r.n.id)) next.splice(Math.min(i, next.length), 0, { n: r.n, leaving: true })
    })
    setRows(next)
  }
  useEffect(() => {
    if (!rows.some((r) => r.leaving)) return
    const t = setTimeout(() => setRows((rs) => rs.filter((r) => !r.leaving)), 200)
    return () => clearTimeout(t)
  }, [rows])
  // Las filas vivas enseñan siempre el último texto; las que salen, el que tenían.
  return rows.map((r) => (r.leaving ? r : { n: notices.find((n) => n.id === r.n.id) ?? r.n, leaving: false }))
}
