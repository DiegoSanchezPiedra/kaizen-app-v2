import QRCode from 'qrcode'
import { useMemo } from 'react'

// Siempre oscuro sobre blanco, también en modo oscuro: muchos lectores no leen un QR invertido. Pesa por `qrcode`:
// solo lo importan pantallas que van en trozo aparte (la tablet y el MFA del panel).
export function QrCode({ value, label }: { value: string; label: string }) {
  const { size, data } = useMemo(() => QRCode.create(value, { errorCorrectionLevel: 'M' }).modules, [value])
  const path = useMemo(() => {
    let d = ''
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) if (data[y * size + x]) d += `M${x} ${y}h1v1h-1z`
    return d
  }, [size, data])
  return (
    <svg viewBox={`-4 -4 ${size + 8} ${size + 8}`} shapeRendering="crispEdges" role="img" aria-label={label} className="block size-full">
      <path d={path} fill="#050A2E" />
    </svg>
  )
}
