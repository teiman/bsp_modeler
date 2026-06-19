import { describe, it, expect, beforeEach } from 'vitest'
import { createModel, placeBlock, setFaceTexture, faceId, serialize, resetBlockIds } from '../src/core/model.js'
import { writeMap } from '../server/compile/mapWriter.js'
import { brushFromFaces } from '../server/compile/brushes.js'
import { instanceBlock } from '../src/core/instance.js'

beforeEach(() => resetBlockIds(0))

describe('mapWriter', () => {
  it('emite un .map con worldspawn, info_player_start y skybox', () => {
    const m = createModel()
    placeBlock(m, 'cube', [0, 0, 0])
    const { map, textures } = writeMap(serialize(m))
    expect(map).toContain('"classname" "worldspawn"')
    expect(map).toContain('"classname" "info_player_start"')
    expect(map).toContain('"wad" "textures.wad"')
    // skybox sella -> hay caras con la textura sky
    expect(map).toContain(' sky ')
    expect(textures).toContain('sky')
    expect(textures).toContain('default')
  })

  it('incluye la textura asignada a una cara', () => {
    const m = createModel()
    const b = placeBlock(m, 'cube', [0, 0, 0])
    setFaceTexture(m, faceId(b.id, '+Z'), 'brick')
    const { map, textures } = writeMap(serialize(m))
    expect(textures).toContain('brick')
    expect(map).toContain(' brick ')
  })

  it('cada cara del brush es una linea Valve 220 con 3 puntos', () => {
    const m = createModel()
    const b = placeBlock(m, 'cube', [0, 0, 0])
    const inst = instanceBlock(b, m.cellSize)
    const brush = brushFromFaces(inst.brushes[0], () => 'default')
    const lines = brush.split('\n').filter((l) => l.startsWith('('))
    expect(lines).toHaveLength(6)
    for (const l of lines) {
      // 3 grupos ( x y z )
      expect((l.match(/\(/g) || []).length).toBe(3)
      // ejes de textura [ ... ] [ ... ]
      expect((l.match(/\[/g) || []).length).toBe(2)
    }
  })
})
