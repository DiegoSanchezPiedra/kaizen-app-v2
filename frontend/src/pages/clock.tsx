import { useSearchParams } from 'react-router'
import { ClockLog, MonthNav } from '@/components/clock-log'
import { Page } from '@/components/page'
import { QueryView } from '@/components/screen-state'
import { madridMonth } from '@/lib/dates'
import { queryClient } from '@/lib/logout'
import { useClock } from '@/lib/queries'

const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/

// «Mi registro» (B31): el mes de jornada del profesor, con sus correcciones. Enlazada desde Cuenta y desde los avisos.
export function ClockPage() {
  const [params, setParams] = useSearchParams()
  const month = MONTH.test(params.get('month') ?? '') ? params.get('month')! : madridMonth()
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
