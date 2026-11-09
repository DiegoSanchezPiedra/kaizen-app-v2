// Temáticas de medallas (CONTEXT § Temática, migrations/036): el arte y los nombres de cada una, por código.
// Añadir un anime: un archivo aquí + su fila en medal_themes (una migración). Una temática de la BD sin archivo
// aquí no se ofrece en el admin y se ve como Kaizen.
// shortcut: los nombres y el arte son de las series (de terceros, solo pruebas); pasarlos a los de género
// (docs/research/medallas-shonen.md) antes de que haya producción. Los códigos no cambian.
import hunter from './hunter'
import ippo from './ippo'
import kaizen from './kaizen'
import mugiwara from './mugiwara'
import naruto from './naruto'
import saiyan from './saiyan'
import shinigami from './shinigami'
import titanes from './titanes'

// Cada forma la dibuja components/medal.tsx.
export type Shape = 'burst' | 'belt' | 'orb' | 'shield' | 'poster' | 'plate' | 'seal' | 'card'
// c1/c2: luz y sombra del cuerpo; accent: el detalle (estallido, correa, estrellas…); hanko: el sello del kanji.
export type Palette = { c1: string; c2: string; accent: string; hanko: string }
// Por código de la escalera (LADDER): [nombre, marca corta del centro, paleta propia si cambia].
export type ThemeArt = { code: string; series: string; shape: Shape; kanji: string; palette: Palette; medals: Record<string, [string, string, Palette?]> }

export const KAIZEN = kaizen
export const THEMES: Record<string, ThemeArt> = Object.fromEntries(
  [ippo, titanes, saiyan, mugiwara, naruto, shinigami, hunter].map((t) => [t.code, t]))
