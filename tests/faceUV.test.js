import { describe, it, expect, beforeEach } from 'vitest'
import { createModel, placeBlock, setFaceTexture, setFaceParams, faceId, serialize, deserialize, resetBlockIds, CELL_SIZE } from '../src/core/model.js'
import { instanceBlock } from '../src/core/instance.js'
import { faceAxes, pointUV, TEX_SIZE } from '../src/core/faceUV.js'
import { writeMap } from '../server/compile/mapWriter.js'

beforeEach(() => resetBlockIds(0))

describe('texturizado por cara (BSP)', () => {
  it('una cara de cubo recibe exactamente 1 textura (1:1) con escala 1', () => {
    // Celda = 64, textura = 64, escala 1 -> el span de UV de la cara debe ser 1.0.
    expect(CELL_SIZE).toBe(64)
    const m = createModel()
    const b = placeBlock(m, 'cube', [0, 0, 0])
    const inst = instanceBlock(b, m.cellSize)
    const top = inst.brushes[0].find((f) => f.name === '+Z')
    const axes = faceAxes(top.normal, { scale: [1, 1] })
    const us = top.verts.map((p) => pointUV(p, axes, { scale: [1, 1] })[0])
    const vs = top.verts.map((p) => pointUV(p, axes, { scale: [1, 1] })[1])
    const spanU = Math.max(...us) - Math.min(...us)
    const spanV = Math.max(...vs) - Math.min(...vs)
    expect(spanU).toBeCloseTo(1, 5)
    expect(spanV).toBeCloseTo(1, 5)
  })

  it('la escala 2 duplica el span (la textura se ve la mitad de grande)', () => {
    const m = createModel()
    const b = placeBlock(m, 'cube', [0, 0, 0])
    const top = instanceBlock(b, m.cellSize).brushes[0].find((f) => f.name === '+Z')
    const axes = faceAxes(top.normal, { scale: [2, 2] })
    const us = top.verts.map((p) => pointUV(p, axes, { scale: [2, 2] })[0])
    expect(Math.max(...us) - Math.min(...us)).toBeCloseTo(0.5, 5)
  })

  it('el .map emite scale por cara y el offset del usuario desplaza la textura', () => {
    const lineFor = (off) => {
      const m = createModel()
      const b = placeBlock(m, 'cube', [0, 0, 0])
      setFaceTexture(m, faceId(b.id, '+Z'), 'brick')
      setFaceParams(m, faceId(b.id, '+Z'), { scale: [2, 3], offset: [off, 0] })
      return writeMap(serialize(m)).map.split('\n').find((l) => l.includes(' brick '))
    }
    const l0 = lineFor(0)
    expect(l0.trim().endsWith('0 2 3')).toBe(true) // rot uScale vScale
    // El offset emitido lleva horneado el anclaje a la esquina de la cara; un
    // offset de usuario +8 debe producir un uOffset 8 mayor que el de offset 0.
    const uOff = (l) => Number(/\[\s*\S+\s+\S+\s+\S+\s+(\S+)\s*\]/.exec(l)[1])
    expect(uOff(lineFor(8)) - uOff(l0)).toBeCloseTo(8, 5)
  })

  it('cambiar de textura conserva los params de ajuste', () => {
    const m = createModel()
    const b = placeBlock(m, 'cube', [0, 0, 0])
    const fid = faceId(b.id, '+Z')
    setFaceTexture(m, fid, 'brick')
    setFaceParams(m, fid, { scale: [4, 4], rot: 90 })
    setFaceTexture(m, fid, 'metal') // recolorear
    expect(m.faceTextures[fid]).toEqual({ tex: 'metal', scale: [4, 4], offset: [0, 0], rot: 90 })
  })

  it('carga el formato viejo (string) como objeto con defaults', () => {
    const old = {
      format: 'bsp-modeler/1', cellSize: 64,
      blocks: [{ id: 'b0', key: 'cube', cell: [0, 0, 0], rot: 0 }],
      faceTextures: { 'b0:+Z': 'brick' },
    }
    const m = deserialize(old)
    expect(m.faceTextures['b0:+Z']).toEqual({ tex: 'brick', scale: [1, 1], offset: [0, 0], rot: 0 })
  })
})
