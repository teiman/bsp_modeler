import { describe, it, expect, beforeEach } from 'vitest'
import {
  createModel, placeBlock, removeBlock, rotateBlock, blockAtCell,
  setFaceTexture, faceId, serialize, deserialize, resetBlockIds,
} from '../src/core/model.js'

beforeEach(() => resetBlockIds(0))

describe('modelo', () => {
  it('coloca y encuentra un bloque en una celda', () => {
    const m = createModel()
    const b = placeBlock(m, 'cube', [1, 2, 3])
    expect(m.blocks).toHaveLength(1)
    expect(blockAtCell(m, [1, 2, 3])).toBe(b)
    expect(blockAtCell(m, [0, 0, 0])).toBeNull()
  })

  it('reemplaza el bloque al colocar en una celda ocupada', () => {
    const m = createModel()
    placeBlock(m, 'cube', [0, 0, 0])
    placeBlock(m, 'ramp', [0, 0, 0])
    expect(m.blocks).toHaveLength(1)
    expect(blockAtCell(m, [0, 0, 0]).key).toBe('ramp')
  })

  it('borra el bloque y sus texturas', () => {
    const m = createModel()
    const b = placeBlock(m, 'cube', [0, 0, 0])
    setFaceTexture(m, faceId(b.id, '+Z'), 'brick')
    expect(Object.keys(m.faceTextures)).toHaveLength(1)
    removeBlock(m, [0, 0, 0])
    expect(m.blocks).toHaveLength(0)
    expect(Object.keys(m.faceTextures)).toHaveLength(0)
  })

  it('rota en pasos de 90 (mod 4)', () => {
    const m = createModel()
    const b = placeBlock(m, 'cube', [0, 0, 0])
    rotateBlock(m, [0, 0, 0]); expect(b.rot).toBe(1)
    rotateBlock(m, [0, 0, 0]); rotateBlock(m, [0, 0, 0]); rotateBlock(m, [0, 0, 0])
    expect(b.rot).toBe(0)
  })

  it('round-trips por serialize/deserialize', () => {
    const m = createModel()
    const b = placeBlock(m, 'bevel', [2, -1, 4], 2)
    setFaceTexture(m, faceId(b.id, 'bevel'), 'metal')
    const data = JSON.parse(JSON.stringify(serialize(m)))
    const m2 = deserialize(data)
    expect(m2.blocks).toEqual(m.blocks)
    expect(m2.faceTextures).toEqual(m.faceTextures)
  })

  it('rechaza un formato desconocido', () => {
    expect(() => deserialize({ format: 'otro' })).toThrow()
  })
})
