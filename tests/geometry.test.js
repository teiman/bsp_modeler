import { describe, it, expect, beforeEach } from 'vitest'
import { createModel, placeBlock, resetBlockIds } from '../src/core/model.js'
import { instanceBlock, instanceModel } from '../src/core/instance.js'
import { MODULE_LIST } from '../src/blocks/catalog.js'
import { CELL_SIZE } from '../src/core/model.js'

beforeEach(() => resetBlockIds(0))

describe('instanciado / geometria', () => {
  it('el cubo produce 1 brush de 6 caras', () => {
    const m = createModel()
    const b = placeBlock(m, 'cube', [0, 0, 0])
    const inst = instanceBlock(b, m.cellSize)
    expect(inst.brushes).toHaveLength(1)
    expect(inst.brushes[0]).toHaveLength(6)
  })

  it('cada modulo produce al menos una brush con caras validas', () => {
    for (const def of MODULE_LIST) {
      const m = createModel()
      const b = placeBlock(m, def.key, [0, 0, 0])
      const inst = instanceBlock(b, m.cellSize)
      expect(inst.brushes.length).toBeGreaterThan(0)
      for (const brush of inst.brushes) {
        expect(brush.length).toBeGreaterThanOrEqual(4)
        for (const face of brush) {
          expect(face.verts.length).toBeGreaterThanOrEqual(3)
          // normal unitaria
          const n = face.normal
          const len = Math.hypot(n[0], n[1], n[2])
          expect(len).toBeCloseTo(1, 5)
          // faceId estable: <blockId>:<name>
          expect(face.faceId.startsWith(b.id + ':')).toBe(true)
        }
      }
    }
  })

  it('coloca el cubo centrado en cell*cellSize', () => {
    const m = createModel()
    const b = placeBlock(m, 'cube', [2, 0, 0])
    const inst = instanceBlock(b, m.cellSize)
    const xs = inst.brushes[0].flatMap((f) => f.verts.map((v) => v[0]))
    const cx = (Math.min(...xs) + Math.max(...xs)) / 2
    expect(cx).toBeCloseTo(2 * CELL_SIZE, 5)
  })

  it('la rotacion del cubo mantiene 6 caras y reasigna nombres laterales', () => {
    const m = createModel()
    const b = placeBlock(m, 'cube', [0, 0, 0], 1)
    const inst = instanceBlock(b, m.cellSize)
    const names = inst.brushes[0].map((f) => f.name).sort()
    expect(names).toEqual(['+X', '+Y', '+Z', '-X', '-Y', '-Z'].sort())
  })

  it('instanceModel instancia todos los bloques', () => {
    const m = createModel()
    placeBlock(m, 'cube', [0, 0, 0])
    placeBlock(m, 'ramp', [1, 0, 0])
    expect(instanceModel(m)).toHaveLength(2)
  })
})
