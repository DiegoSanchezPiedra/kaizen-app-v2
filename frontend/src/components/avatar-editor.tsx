import { useMutation } from '@tanstack/react-query'
import { Trash2Icon, ZoomInIcon, ZoomOutIcon } from 'lucide-react'
import { useRef, useState } from 'react'
import { ConfirmDialog } from '@/components/confirm-dialog'
import { ProfileAvatar } from '@/components/profile-avatar'
import { Button } from '@/components/ui/button'
import { Dialog, DialogDescription, DialogFooter, DialogHeader, DialogPanel, DialogPopup, DialogTitle } from '@/components/ui/dialog'
import { Slider } from '@/components/ui/slider'
import { toastManager } from '@/components/ui/toast'
import { api } from '@/lib/api'
import { cropRect } from '@/lib/avatar'
import { queryClient } from '@/lib/logout'
import { toastError, toastOk } from '@/lib/notify'
import { path } from '@/lib/url'

const VIEW = 280 // lado del encuadre en pantalla (cabe en 375 px con el relleno del diálogo)
const OUT = 512 // lado de la foto que se sube (ADR 0019)

const unreadable = () => toastManager.add({ type: 'error', title: 'No hemos podido leer esa imagen. Prueba con otra foto.', timeout: 5000 })

// Encuadre cuadrado: se arrastra la foto (o con las flechas) y el zoom la acerca; el círculo es lo que se verá.
function CropDialog({ img, saving, onCancel, onSave }: { img: HTMLImageElement; saving: boolean; onCancel: () => void; onSave: (b: Blob) => void }) {
  const w = img.naturalWidth
  const h = img.naturalHeight
  const [zoom, setZoom] = useState(1)
  const [c, setC] = useState({ x: w / 2, y: h / 2 })
  const drag = useRef<{ x: number; y: number } | null>(null)
  const r = cropRect(w, h, zoom, c.x, c.y)
  const scale = VIEW / r.size // píxeles de pantalla por píxel de la foto

  // dx, dy: lo que se mueve la foto en pantalla; el centro del encuadre va al revés.
  const move = (dx: number, dy: number) =>
    setC((p) => {
      const q = cropRect(w, h, zoom, p.x - dx / scale, p.y - dy / scale)
      return { x: q.sx + q.size / 2, y: q.sy + q.size / 2 }
    })

  function save() {
    const canvas = document.createElement('canvas')
    canvas.width = canvas.height = OUT
    const ctx = canvas.getContext('2d')
    if (!ctx) return unreadable()
    ctx.fillStyle = '#fff' // un PNG transparente no debe quedar negro en JPEG
    ctx.fillRect(0, 0, OUT, OUT)
    ctx.drawImage(img, r.sx, r.sy, r.size, r.size, 0, 0, OUT, OUT)
    // El JPEG nuevo no lleva EXIF (ni GPS).
    canvas.toBlob((b) => (b ? onSave(b) : unreadable()), 'image/jpeg', 0.85)
  }

  return (
    <Dialog open onOpenChange={(o) => !o && !saving && onCancel()}>
      <DialogPopup closeProps={{ 'aria-label': 'Cerrar' }}>
        <DialogHeader>
          <DialogTitle>Encuadra la foto</DialogTitle>
          <DialogDescription>Arrastra la foto para moverla. El círculo es lo que se verá.</DialogDescription>
        </DialogHeader>
        <DialogPanel className="flex flex-col items-center gap-5">
          <div
            role="group"
            tabIndex={0}
            aria-label="Encuadre de la foto: arrastra o usa las flechas"
            className="relative cursor-grab touch-none overflow-hidden rounded-lg bg-muted outline-none select-none focus-visible:ring-2 focus-visible:ring-ring active:cursor-grabbing"
            style={{ width: VIEW, height: VIEW }}
            onPointerDown={(e) => {
              e.currentTarget.setPointerCapture(e.pointerId)
              drag.current = { x: e.clientX, y: e.clientY }
            }}
            onPointerMove={(e) => {
              if (!drag.current) return
              move(e.clientX - drag.current.x, e.clientY - drag.current.y)
              drag.current = { x: e.clientX, y: e.clientY }
            }}
            onPointerUp={() => (drag.current = null)}
            onPointerCancel={() => (drag.current = null)}
            onKeyDown={(e) => {
              const step = { ArrowLeft: [16, 0], ArrowRight: [-16, 0], ArrowUp: [0, 16], ArrowDown: [0, -16] }[e.key]
              if (!step) return
              e.preventDefault()
              move(step[0], step[1])
            }}
          >
            <img src={img.src} alt="" draggable={false} className="pointer-events-none absolute max-w-none" style={{ width: w * scale, height: h * scale, left: -r.sx * scale, top: -r.sy * scale }} />
            <div className="pointer-events-none absolute inset-0 rounded-full shadow-[0_0_0_200px_rgb(0_0_0/0.55)] outline-2 -outline-offset-2 outline-white/70" />
          </div>
          <div className="flex w-full max-w-70 items-center gap-3 text-muted-foreground">
            <ZoomOutIcon className="size-5 shrink-0" aria-hidden="true" />
            <Slider min={1} max={3} step={0.02} value={zoom} onValueChange={(v) => setZoom(Array.isArray(v) ? v[0] : v)} getAriaLabel={() => 'Zoom'} className="py-3" />
            <ZoomInIcon className="size-5 shrink-0" aria-hidden="true" />
          </div>
        </DialogPanel>
        <DialogFooter>
          <Button type="button" variant="outline" size="xl" disabled={saving} onClick={onCancel}>
            Cancelar
          </Button>
          <Button type="button" size="xl" loading={saving} onClick={save}>
            Guardar foto
          </Button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  )
}

// Foto grande con Subir/Cambiar y Quitar. `profileId`: la de un hijo (la sube su tutor). `children`: el nombre al lado.
export function AvatarEditor({ name, avatar, profileId, children }: { name: string | null; avatar: string | null | undefined; profileId?: string; children?: React.ReactNode }) {
  const input = useRef<HTMLInputElement>(null)
  const [picked, setPicked] = useState<HTMLImageElement | null>(null)
  const [removing, setRemoving] = useState(false)
  const url = path('/me/avatar', { profile_id: profileId })
  const done = () => queryClient.invalidateQueries({ queryKey: ['me'] }) // /me y /me/children

  const close = () => setPicked(null)
  const upload = useMutation({
    mutationFn: (blob: Blob) => api(url, { method: 'PUT', body: blob }), // body Blob: api() manda su tipo (image/jpeg)
    onSuccess: async () => {
      toastOk('Foto guardada')
      close()
      await done()
    },
    onError: (err) => toastError(err),
  })
  const remove = useMutation({
    mutationFn: () => api(url, { method: 'DELETE' }),
    onSuccess: async () => {
      toastOk('Foto quitada')
      setRemoving(false)
      await done()
    },
    onError: (err) => {
      setRemoving(false)
      toastError(err)
    },
  })

  function choose(file: File | undefined) {
    if (!file) return
    if (!file.type.startsWith('image/')) return unreadable()
    // data: y no blob:: la CSP de nginx (img-src 'self' data:) no deja cargar un blob: en un <img>.
    const reader = new FileReader()
    reader.onerror = unreadable
    reader.onload = () => {
      const img = new Image()
      img.onload = () => (img.naturalWidth && img.naturalHeight ? setPicked(img) : unreadable())
      img.onerror = unreadable
      img.src = reader.result as string
    }
    reader.readAsDataURL(file)
  }

  return (
    <div className="flex items-center gap-4">
      <ProfileAvatar name={name} avatar={avatar} className="size-20 text-3xl" />
      <div className="flex min-w-0 flex-1 flex-col gap-2.5">
        {children}
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="lg" onClick={() => input.current?.click()}>
            {avatar ? 'Cambiar' : 'Subir foto'}
          </Button>
          {avatar && (
            <Button variant="ghost" size="lg" onClick={() => setRemoving(true)}>
              <Trash2Icon />
              Quitar
            </Button>
          )}
        </div>
      </div>
      <input
        ref={input}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        className="hidden"
        onChange={(e) => {
          choose(e.target.files?.[0])
          e.target.value = '' // elegir otra vez el mismo fichero también cuenta
        }}
      />
      {picked && <CropDialog img={picked} saving={upload.isPending} onCancel={close} onSave={(b) => upload.mutate(b)} />}
      <ConfirmDialog
        open={removing}
        onOpenChange={(o) => !o && !remove.isPending && setRemoving(false)}
        title="¿Quitar la foto?"
        description="Se verán las iniciales en su lugar."
        confirmLabel="Quitar foto"
        loading={remove.isPending}
        onConfirm={() => remove.mutate()}
      />
    </div>
  )
}
