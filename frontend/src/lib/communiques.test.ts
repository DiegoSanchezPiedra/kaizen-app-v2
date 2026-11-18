import { describe, expect, it } from 'vitest'
import { whatsappUrl } from './communiques'

describe('whatsappUrl', () => {
  it('título en negrita, línea en blanco y el texto, todo codificado', () => {
    const url = whatsappUrl({ title: ' Cerrado & lunes ', body: 'Por obras.\nVolvemos el martes. ' })
    expect(url.startsWith('https://wa.me/?text=')).toBe(true)
    expect(decodeURIComponent(url.slice('https://wa.me/?text='.length))).toBe('*Cerrado & lunes*\n\nPor obras.\nVolvemos el martes.')
    expect(url).not.toContain('&lunes')
  })
})
