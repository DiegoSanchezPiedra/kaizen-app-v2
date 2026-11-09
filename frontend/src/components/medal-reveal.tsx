import { Dialog as DialogPrimitive } from '@base-ui/react/dialog'
import { useQuery } from '@tanstack/react-query'
import { type ReactNode, useState } from 'react'
import { Link } from 'react-router'
import { Medal } from '@/components/medal'
import { Button } from '@/components/ui/button'
import { useNow } from '@/hooks/use-now'
import { type Medal as MedalInfo, medalGoal, medalsToCelebrate } from '@/lib/progress'
import { api } from '@/lib/api'
import { markMedalsSeen } from '@/lib/queries'
import { useSession } from '@/lib/session'
import type { MyProfile, Progress } from '@/lib/types'

// El momento de la medalla nueva (Inicio y Progreso): la más reciente sin celebrar, a pantalla completa, y «+N» si
// hay más. Al cerrarla, quien mira guarda en el servidor los códigos ya celebrados (034) y no vuelve en ningún dispositivo.
// Cerradas en esta sesión de la app (perfil:código): no se repiten al remontar (otro mes, Inicio → Progreso)
// mientras llega el progreso con el visto nuevo.
const dismissed = new Set<string>()

export function MedalReveal({ progress, profileId, name }: { progress: Progress; profileId?: string; name?: string }) {
  const [, rerender] = useState(0)
  const now = useNow()
  // El propio alumno que aún no compite (no es público o no enseña ranking y logros): se le invita al cerrar.
  const role = useSession()?.role
  const self = !name && role === 'alumno'
  const mine = useQuery({ queryKey: ['my-profile'], queryFn: () => api<MyProfile>('/me/profile'), enabled: self })
  const nudge = self && mine.data && !(mine.data.is_public && mine.data.visible_fields.ranking && mine.data.visible_fields.achievements)
  const key = (code: string) => `${profileId ?? 'self'}:${code}`
  const [first, ...rest] = medalsToCelebrate(progress.badges, progress.medals_seen, new Date(now)).filter((x) => !dismissed.has(key(x.code)))
  if (!first) return null
  const close = () => {
    for (const x of [first, ...rest]) dismissed.add(key(x.code))
    rerender((n) => n + 1)
    // Todas las que tiene, no solo las de la ventana: las viejas no deben salir después como nuevas.
    void markMedalsSeen(profileId, progress.badges.map((b) => b.code)).catch(() => {}) // sin red, vuelve a salir la próxima vez: no se pierde
  }
  return (
    <MedalDialog medal={first} more={rest.length} name={name} label="¡Medalla nueva!" onClose={close}>
      {nudge && (
        <Link to="/account/profile" onClick={close} className="relative animate-medal-late text-sm font-semibold text-white underline underline-offset-3">
          Enseña tus medallas y compite en el ranking
        </Link>
      )}
    </MedalDialog>
  )
}

// La animación de una medalla a pantalla completa: la nueva (arriba) o una ya conseguida que se vuelve a ver (Progreso).
export function MedalDialog({ medal: first, more = 0, name, label, onClose, children }: { medal: MedalInfo; more?: number; name?: string; label: string; onClose: () => void; children?: ReactNode }) {
  return (
    <DialogPrimitive.Root open onOpenChange={(open) => !open && onClose()}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Popup className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-3 overflow-hidden bg-brand-ink px-4 py-6 text-center text-white outline-none">
          <div aria-hidden="true" className="pointer-events-none absolute top-1/2 left-1/2 size-[260vmax] -translate-1/2 animate-medal-rays rounded-full bg-[repeating-conic-gradient(rgb(255_210_63/0.16)_0deg_4deg,transparent_4deg_14deg)]" />
          <div aria-hidden="true" className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_50%_40%,rgb(255_122_0/0.45),transparent_48%)]" />
          <div className="relative grid size-56 place-items-center">
            <span aria-hidden="true" className="absolute inset-5 animate-medal-ring rounded-full border-4 border-[#FFD23F]/85" />
            <span aria-hidden="true" className="absolute inset-5 animate-medal-ring rounded-full border-3 border-power/70 [animation-delay:180ms]" />
            <Medal medal={first} earned className="size-48 animate-medal-in" />
          </div>
          <div className="relative flex animate-medal-late flex-col items-center gap-2">
            <p className="-rotate-3 border-2 border-black bg-[#D7262E] px-2.5 py-1 text-sm font-extrabold tracking-widest uppercase shadow-[3px_3px_0_#000]">
              {label}
            </p>
            <DialogPrimitive.Title className="mt-1 font-heading text-6xl leading-[0.9] font-extrabold text-[#FFD23F] uppercase italic [text-shadow:4px_4px_0_var(--power),7px_7px_0_#000]">
              {first.name}
            </DialogPrimitive.Title>
            <DialogPrimitive.Description className="text-base font-semibold">
              {name ? `${name} lo ha conseguido` : 'Lo has conseguido'}: {medalGoal(first)}
              {first.kind === 'hours' && first.at > 0 ? ' entrenando' : first.kind === 'streak' ? ' seguidas' : ''}
            </DialogPrimitive.Description>
            {more > 0 && (
              <p className="text-sm text-white/80">
                +{more} {more === 1 ? 'medalla más' : 'medallas más'} en Progreso
              </p>
            )}
          </div>
          <DialogPrimitive.Close
            render={
              <Button size="xl" className="relative mt-6 w-full max-w-sm animate-medal-late border-3 border-black bg-[#FFD23F] font-extrabold tracking-wide text-black uppercase shadow-[4px_4px_0_#000] hover:bg-[#FFD23F]/90" />
            }
          >
            Seguir
          </DialogPrimitive.Close>
          {children}
          <div aria-hidden="true" className="pointer-events-none absolute inset-0 animate-medal-flash bg-white opacity-0" />
        </DialogPrimitive.Popup>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  )
}
