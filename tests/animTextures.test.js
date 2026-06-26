import { describe, it, expect } from 'vitest'
import { animFrames } from '../server/compile/textures.js'
import { nearestIndex, FULLBRIGHT_START, PALETTE_SIZE, QUAKE_PALETTE } from '../server/compile/quakePalette.js'

describe('texturas animadas (convencion + de Quake)', () => {
  const ids = ['brick', '+0panel', '+1panel', '+2panel', '+0lamp', '+alamp', 'metal']

  it('expande +0name a todos sus frames hermanos presentes', async () => {
    const frames = await animFrames('+0panel', ids)
    expect(frames).toEqual(['+0panel', '+1panel', '+2panel'])
  })

  it('agrupa por nombre base, no mezcla animaciones distintas', async () => {
    const frames = await animFrames('+0lamp', ids)
    expect(frames).toEqual(['+0lamp', '+alamp']) // par normal/switch del mismo lamp
    expect(frames).not.toContain('+0panel')
  })

  it('una textura normal se devuelve sola (no animada)', async () => {
    expect(await animFrames('brick', ids)).toEqual(['brick'])
    expect(await animFrames('metal', ids)).toEqual(['metal'])
  })

  it('si el frame referenciado no existe en disco, se devuelve tal cual', async () => {
    expect(await animFrames('+0ghost', ids)).toEqual(['+0ghost'])
  })
})

describe('cuantizacion fullbright (carpeta textures/fb/)', () => {
  it('por defecto NUNCA devuelve un indice fullbright', () => {
    // Rojo puro: sin fullbright cae en un rojo NORMAL (<224), no en el 251.
    expect(nearestIndex(255, 0, 0)).toBeLessThan(FULLBRIGHT_START)
    expect(nearestIndex(255, 255, 255)).toBeLessThan(FULLBRIGHT_START)
  })

  it('con fullbright=true SIEMPRE devuelve un indice 224..255', () => {
    for (const [r, g, b] of [[255, 0, 0], [255, 255, 255], [0, 0, 0], [120, 235, 120]]) {
      const idx = nearestIndex(r, g, b, true)
      expect(idx).toBeGreaterThanOrEqual(FULLBRIGHT_START)
      expect(idx).toBeLessThan(PALETTE_SIZE)
    }
  })

  it('rojo puro fullbright cae en el rojo brillante de la rampa', () => {
    expect(nearestIndex(255, 0, 0, true)).toBe(251) // rgb(255,0,0) fullbright
  })
})

describe("cuantizacion 'all' (carpeta textures/all/, toda la paleta)", () => {
  it('un color exacto de la paleta cae en su indice exacto, sea cual sea', () => {
    // Recorre TODA la paleta: cada color exacto debe mapear a SU indice (no a un
    // vecino). Excepto duplicados (p.ej. varios negros), donde basta que el color
    // del indice elegido sea identico.
    for (let i = 0; i < PALETTE_SIZE; i++) {
      const [r, g, b] = QUAKE_PALETTE[i]
      const idx = nearestIndex(r, g, b, 'all')
      expect(QUAKE_PALETTE[idx]).toEqual([r, g, b])
    }
  })

  it('decide fullbright POR PIXEL: un color fullbright cae en >=224, uno normal en <224', () => {
    // rgb(255,0,0) es exactamente el fullbright 251 -> 'all' lo coge (>=224).
    expect(nearestIndex(255, 0, 0, 'all')).toBeGreaterThanOrEqual(FULLBRIGHT_START)
    // Un gris exacto de la rampa normal (indice 8 = [123,123,123]) cae en zona normal.
    expect(nearestIndex(123, 123, 123, 'all')).toBeLessThan(FULLBRIGHT_START)
  })

  it("el booleano antiguo sigue funcionando (true==fb, false==normal)", () => {
    expect(nearestIndex(255, 0, 0, true)).toBe(nearestIndex(255, 0, 0, 'fb'))
    expect(nearestIndex(255, 0, 0, false)).toBe(nearestIndex(255, 0, 0, 'normal'))
  })
})
