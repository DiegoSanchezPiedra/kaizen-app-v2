import { useState } from 'react'
import { useSearchParams } from 'react-router'
import { addDays, madridDay } from '@/lib/dates'
import { pickDay, resolveWeekDay, shiftWeek, todayOf, weekQuery, type WeekDay } from '@/lib/week'

// Semana y día del calendario semanal, en la URL (`?semana=`, `?dia=`); el resto de parámetros (?para=, ?tab=…) se conserva.
export function useWeek() {
  const [params, setParams] = useSearchParams()
  const today = madridDay()
  const current = resolveWeekDay(params.get('semana'), params.get('dia'), today)
  // Hacia dónde se movió la última vez, para que el contenido entre desde ese lado.
  const [dir, setDir] = useState<1 | -1>(1)

  const go = (next: WeekDay) => {
    setDir(next.day >= current.day ? 1 : -1)
    const q = weekQuery(next, today)
    setParams(
      (p) => {
        const n = new URLSearchParams(p)
        for (const [k, v] of Object.entries(q)) {
          if (v) n.set(k, v)
          else n.delete(k)
        }
        return n
      },
      { replace: true },
    )
  }

  return {
    ...current,
    today,
    dir,
    days: Array.from({ length: 7 }, (_, i) => addDays(current.week, i)),
    isCurrent: current.week === pickDay(today).week,
    pick: (day: string) => go(pickDay(day)),
    shift: (n: number) => go(shiftWeek(current, n, today)),
    reset: () => go(todayOf(today)),
  }
}
export type Week = ReturnType<typeof useWeek>
