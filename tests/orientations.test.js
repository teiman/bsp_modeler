import { describe, it, expect, beforeEach } from 'vitest'
import {
  ORIENTATION_COUNT, applyOrient, orientFaceName, rotateOrientation, ORIENT_IDENTITY,
} from '../src/core/orientations.js'
import { createModel, placeBlock, resetBlockIds } from '../src/core/model.js'
import { instanceBlock } from '../src/core/instance.js'

beforeEach(() => resetBlockIds(0))

function sub(a, b) { return [a[0] - b[0], a[1] - b[1], a[2] - b[2]] }
function cross(a, b) { return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]] }
function dot(a, b) { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2] }

describe('orientaciones del cubo', () => {
  it('hay exactamente 24', () => {
    expect(ORIENTATION_COUNT).toBe(24)
  })

  it('las 4 primeras son el yaw puro (Z no cambia)', () => {
    for (let o = 0; o < 4; o++) {
      const z = applyOrient(o, [0, 0, 1]).map(Math.round)
      expect(z).toEqual([0, 0, 1])
    }
  })

  it('todas preservan la orientacion (determinante +1, sin reflejos)', () => {
    for (let o = 0; o < ORIENTATION_COUNT; o++) {
      const x = applyOrient(o, [1, 0, 0])
      const y = applyOrient(o, [0, 1, 0])
      const z = applyOrient(o, [0, 0, 1])
      // det = x · (y × z) debe ser +1
      expect(Math.round(dot(x, cross(y, z)))).toBe(1)
    }
  })

  it('existe una orientacion que pone la rampa boca abajo (su techo mira a -Z)', () => {
    // En orientacion identidad, la cara +Z superior trasera de la rampa existe;
    // buscamos una orientacion donde la normal +Z del bloque apunte a -Z.
    let found = -1
    for (let o = 0; o < ORIENTATION_COUNT; o++) {
      const up = applyOrient(o, [0, 0, 1]).map(Math.round)
      if (up[0] === 0 && up[1] === 0 && up[2] === -1) { found = o; break }
    }
    expect(found).toBeGreaterThanOrEqual(0)

    const m = createModel()
    const b = placeBlock(m, 'ramp', [0, 0, 0], found)
    const inst = instanceBlock(b, m.cellSize)
    // La cara 'slope' de la rampa ahora debe tener componente Z negativa
    // (mira hacia abajo) en alguna de sus normales.
    const slope = inst.brushes[0].find((f) => f.name === 'slope')
    expect(slope).toBeTruthy()
    expect(slope.normal[2]).toBeLessThan(0)
  })

  it('rotateOrientation en X cuatro veces vuelve al origen', () => {
    let o = ORIENT_IDENTITY
    for (let i = 0; i < 4; i++) o = rotateOrientation(o, 'x', 1)
    expect(o).toBe(ORIENT_IDENTITY)
  })

  it('orientFaceName remapea las caras canonicas y conserva las demas', () => {
    // Una orientacion de yaw (1) manda +X -> +Y.
    expect(orientFaceName('+X', 1)).toBe('+Y')
    // 'slope' no es canonica: se conserva.
    expect(orientFaceName('slope', 5)).toBe('slope')
  })

  it('la geometria rotada sigue siendo solida (caras con normal unitaria)', () => {
    for (let o = 0; o < ORIENTATION_COUNT; o++) {
      const m = createModel()
      const b = placeBlock(m, 'ramp', [0, 0, 0], o)
      const inst = instanceBlock(b, m.cellSize)
      for (const face of inst.brushes[0]) {
        const len = Math.hypot(...face.normal)
        expect(len).toBeCloseTo(1, 5)
      }
    }
  })
})
