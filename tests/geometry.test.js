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

  it('cubo chaflanado: 1 brush de 10 caras, octogono regular, normales hacia fuera', () => {
    const m = createModel()
    const b = placeBlock(m, 'chamferBox', [0, 0, 0])
    const [brush] = instanceBlock(b, m.cellSize).brushes
    expect(brush).toHaveLength(10) // 2 tapas + 4 rectas + 4 chaflanes

    const center = [0, 0, 0]
    for (const face of brush) {
      // Centroide de la cara y normal: la normal debe apuntar HACIA FUERA del
      // centro del solido (producto con (centroide-centro) > 0) -> brush valida.
      const cen = face.verts.reduce((a, v) => [a[0] + v[0], a[1] + v[1], a[2] + v[2]], [0, 0, 0])
        .map((s) => s / face.verts.length)
      const out = [cen[0] - center[0], cen[1] - center[1], cen[2] - center[2]]
      const dot = out[0] * face.normal[0] + out[1] * face.normal[1] + out[2] * face.normal[2]
      expect(dot).toBeGreaterThan(0)
    }

    // Los 4 chaflanes son diagonales a 45°: su normal no tiene componente X y
    // las componentes Y,Z tienen igual magnitud.
    const chamfers = brush.filter((f) => f.name.startsWith('c'))
    expect(chamfers).toHaveLength(4)
    for (const f of chamfers) {
      expect(f.normal[0]).toBeCloseTo(0, 5)
      expect(Math.abs(f.normal[1])).toBeCloseTo(Math.abs(f.normal[2]), 5)
    }
  })

  it('pinchos: 3 brushes convexas con normales hacia fuera', () => {
    const m = createModel()
    const b = placeBlock(m, 'spikes', [0, 0, 0])
    const { brushes } = instanceBlock(b, m.cellSize)
    expect(brushes).toHaveLength(3) // 3 pinchos = 3 brushes
    for (const brush of brushes) {
      // centro del brush = promedio de sus vertices
      const all = brush.flatMap((f) => f.verts)
      const c = all.reduce((a, v) => [a[0] + v[0], a[1] + v[1], a[2] + v[2]], [0, 0, 0]).map((s) => s / all.length)
      for (const f of brush) {
        const cen = f.verts.reduce((a, v) => [a[0] + v[0], a[1] + v[1], a[2] + v[2]], [0, 0, 0]).map((s) => s / f.verts.length)
        const out = [cen[0] - c[0], cen[1] - c[1], cen[2] - c[2]]
        const dot = out[0] * f.normal[0] + out[1] * f.normal[1] + out[2] * f.normal[2]
        expect(dot).toBeGreaterThan(0) // normal hacia fuera -> brush valida para qbsp
      }
    }
  })

  it('piloto: una cajita contenida en su celda, cara trasera a ras del borde, normales hacia fuera', () => {
    const m = createModel()
    const b = placeBlock(m, 'pilots', [0, 0, 0])
    const { brushes } = instanceBlock(b, m.cellSize)
    expect(brushes).toHaveLength(1) // una sola cajita = una brush
    const H = 0.5 * CELL_SIZE
    const eps = 1e-6
    const brush = brushes[0]
    let mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity]
    const all = brush.flatMap((f) => f.verts)
    const c = all.reduce((a, v) => [a[0] + v[0], a[1] + v[1], a[2] + v[2]], [0, 0, 0]).map((s) => s / all.length)
    for (const f of brush) {
      for (const v of f.verts) for (let k = 0; k < 3; k++) { mn[k] = Math.min(mn[k], v[k]); mx[k] = Math.max(mx[k], v[k]) }
      const cen = f.verts.reduce((a, v) => [a[0] + v[0], a[1] + v[1], a[2] + v[2]], [0, 0, 0]).map((s) => s / f.verts.length)
      const out = [cen[0] - c[0], cen[1] - c[1], cen[2] - c[2]]
      const dot = out[0] * f.normal[0] + out[1] * f.normal[1] + out[2] * f.normal[2]
      expect(dot).toBeGreaterThan(0) // normal hacia fuera
    }
    // Cabe entera en su celda [-H, H] (no invade al vecino) y su cara trasera
    // queda exactamente en el borde x=-H (encaja a ras contra el casco).
    for (let k = 0; k < 3; k++) {
      expect(mn[k]).toBeGreaterThanOrEqual(-H - eps)
      expect(mx[k]).toBeLessThanOrEqual(H + eps)
    }
    expect(mn[0]).toBeCloseTo(-H, 5)
  })

  it('instanceModel instancia todos los bloques', () => {
    const m = createModel()
    placeBlock(m, 'cube', [0, 0, 0])
    placeBlock(m, 'ramp', [1, 0, 0])
    expect(instanceModel(m)).toHaveLength(2)
  })
})
