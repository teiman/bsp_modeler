import { describe, it, expect, beforeEach } from 'vitest'
import {
  createModel, placeBlock, removeBlock, removeBlockById, rotateBlock, blockAtCell,
  setFaceTexture, setBlockLabel, faceId, serialize, deserialize, resetBlockIds,
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

  it('borra por id (cualquier capa) y limpia sus texturas', () => {
    const m = createModel()
    const a = placeBlock(m, 'cube', [0, 0, 0])
    const b = placeBlock(m, 'noseCone', [0, 0, 3]) // pieza en otra capa Z
    setFaceTexture(m, faceId(b.id, 'nose+X'), 'metal')
    expect(removeBlockById(m, b.id)).toBe(true)
    expect(m.blocks).toEqual([a])
    expect(Object.keys(m.faceTextures)).toHaveLength(0)
    expect(removeBlockById(m, 'inexistente')).toBe(false)
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

  it('setBlockLabel pone/quita el texto de un ancla y sobrevive al round-trip', () => {
    const m = createModel()
    const a = placeBlock(m, 'anchor', [0, 0, 0])
    expect(a.label).toBeUndefined()
    expect(setBlockLabel(m, a.id, '  frontal barrage  ')).toBe(true) // recorta espacios
    expect(a.label).toBe('frontal barrage')
    // Round-trip conserva el label.
    const m2 = deserialize(JSON.parse(JSON.stringify(serialize(m))))
    expect(m2.blocks[0].label).toBe('frontal barrage')
    // Texto vacio borra el campo (no se serializa).
    setBlockLabel(m, a.id, '   ')
    expect(a.label).toBeUndefined()
    expect(serialize(m).blocks[0].label).toBeUndefined()
    expect(setBlockLabel(m, 'inexistente', 'x')).toBe(false)
  })

  it('rechaza un formato desconocido', () => {
    expect(() => deserialize({ format: 'otro' })).toThrow()
  })
})
