import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router'
import { ClockLog, MonthNav } from '@/components/clock-log'
import { Page } from '@/components/page'
import { QueryView } from '@/components/screen-state'
import { monthParam } from '@/lib/clock'
import { queryClient } from '@/lib/logout'
import { useClock } from '@/lib/queries'

// La entrada escalonada solo en la primera visita de la sesión de la app.
let played = false

// «Mi registro» (B31): el mes de jornada del profesor, con sus correcciones. Enlazada desde Cuenta y desde los avisos.
export function ClockPage() {
  const [params, setParams] = useSearchParams()
  const month = monthParam(params)
  const query = useClock(month)
  const [rise] = useState(!played)
  // Tras cambiar de mes, el mes nuevo entra con enter-soft (es otro nodo por la key).
  const [moved, setMoved] = useState(false)
  useEffect(() => {
    played = true
  }, [])
  return (
    <Page title="Mi registro" lgWide>
      <MonthNav
        month={month}
        onChange={(m) => {
          setMoved(true)
          setParams({ month: m }, { replace: true })
        }}
      />
      <QueryView query={query}>
        {(data) => (
          <div key={month} className={moved ? 'enter-soft' : undefined}>
            <ClockLog data={data} rise={rise && !moved} printTo={`/clock/print?month=${month}`} onChanged={() => void queryClient.invalidateQueries({ queryKey: ['clock'] })} />
          </div>
        )}
      </QueryView>
    </Page>
  )
}
