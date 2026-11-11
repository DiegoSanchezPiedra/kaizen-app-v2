import { useSearchParams } from 'react-router'
import { ClockLog, MonthNav } from '@/components/clock-log'
import { Page } from '@/components/page'
import { QueryView } from '@/components/screen-state'
import { monthParam } from '@/lib/clock'
import { queryClient } from '@/lib/logout'
import { useClock } from '@/lib/queries'

// «Mi registro» (B31): el mes de jornada del profesor, con sus correcciones. Enlazada desde Cuenta y desde los avisos.
export function ClockPage() {
  const [params, setParams] = useSearchParams()
  const month = monthParam(params)
  const query = useClock(month)
  return (
    <Page title="Mi registro">
      <MonthNav month={month} onChange={(m) => setParams({ month: m }, { replace: true })} />
      <QueryView query={query}>
        {(data) => <ClockLog data={data} printTo={`/clock/print?month=${month}`} onChanged={() => void queryClient.invalidateQueries({ queryKey: ['clock'] })} />}
      </QueryView>
    </Page>
  )
}
