import { describe, it, expect, beforeEach } from 'vitest'
import { createModel, placeBlock, setFaceTexture, setBlockLabel, faceId, serialize, resetBlockIds } from '../src/core/model.js'
import { writeMap } from '../server/compile/mapWriter.js'
import { brushFromFaces } from '../server/compile/brushes.js'
import { instanceBlock } from '../src/core/instance.js'

beforeEach(() => resetBlockIds(0))

describe('mapWriter', () => {
  it('emite un modelo-objeto DESNUDO: worldspawn con los brushes, sin skybox ni player_start', () => {
    const m = createModel()
    placeBlock(m, 'cube', [0, 0, 0])
    const { map, textures } = writeMap(serialize(m))
    expect(map).toContain('"classname" "worldspawn"')
    expect(map).toContain('"wad" "textures.wad"')
    // Es un bmodel desnudo: NADA de mundo de nivel.
    expect(map).not.toContain('info_player_start')
    expect(map).not.toContain(' sky ')
    expect(textures).not.toContain('sky')
    expect(textures).toContain('default')
    // El brush del cubo esta presente (6 caras del worldspawn).
    expect(map.split('\n').filter((l) => l.startsWith('(')).length).toBe(6)
  })

  it('incluye la textura asignada a una cara', () => {
    const m = createModel()
    const b = placeBlock(m, 'cube', [0, 0, 0])
    setFaceTexture(m, faceId(b.id, '+Z'), 'brick')
    const { map, textures } = writeMap(serialize(m))
    expect(textures).toContain('brick')
    expect(map).toContain(' brick ')
  })

  it('hull:true emite layout de COLISION DE CASCO: nave en func_wall (*1) + caja-mundo sellada + player_start', () => {
    const m = createModel()
    placeBlock(m, 'cube', [0, 0, 0])
    const { map } = writeMap(serialize(m), { hull: true })
    // La nave ya NO esta en el worldspawn, sino en un func_wall (-> submodelo *1).
    expect(map).toContain('"classname" "func_wall"')
    // El worldspawn lleva la caja-mundo sellada y hay un player_start para que
    // -leaktest no aborte (qbsp construye los hulls del *1).
    expect(map).toContain('"classname" "worldspawn"')
    expect(map).toContain('"classname" "info_player_start"')
    // Caja sellada = 6 losas de 6 caras (36) + las 6 caras del cubo = 42.
    expect(map.split('\n').filter((l) => l.startsWith('(')).length).toBe(42)
  })

  it('hull + sun: caja-mundo sellada con sky y _sunlight cenital en el worldspawn', () => {
    const m = createModel()
    placeBlock(m, 'cube', [0, 0, 0])
    const { map, textures } = writeMap(serialize(m), { hull: true, light: { sun: 1 } })
    // El sol cenital se declara en el worldspawn.
    expect(map).toContain('"_sunlight"')
    expect(map).toContain('"_sun_mangle"')
    // La caja-mundo se sella con sky (por donde entra el sol) y va al WAD.
    expect(map).toContain(' sky ')
    expect(textures).toContain('sky')
    // Sigue siendo el layout de casco (func_wall + player_start).
    expect(map).toContain('"classname" "func_wall"')
    expect(map).toContain('"classname" "info_player_start"')
  })

  it('hull SIN sun: la caja-mundo NO usa sky ni declara _sunlight', () => {
    const m = createModel()
    placeBlock(m, 'cube', [0, 0, 0])
    const { map, textures } = writeMap(serialize(m), { hull: true })
    expect(map).not.toContain('"_sunlight"')
    expect(map).not.toContain(' sky ')
    expect(textures).not.toContain('sky')
  })

  it('por defecto (sin hull) NO mete func_wall ni player_start (modelo desnudo)', () => {
    const m = createModel()
    placeBlock(m, 'cube', [0, 0, 0])
    const { map } = writeMap(serialize(m))
    expect(map).not.toContain('func_wall')
    expect(map).not.toContain('info_player_start')
  })

  it('un ancla (marcador) NO emite brushes: emite una entidad-punto invisible con su texto como classname', () => {
    const m = createModel()
    const a = placeBlock(m, 'anchor', [1, 0, 0])
    setBlockLabel(m, a.id, 'frontal barrage')
    const { map } = writeMap(serialize(m))
    // El texto del ancla acaba como classname de una entidad invisible.
    expect(map).toContain('"classname" "frontal barrage"')
    // Lleva origin (centro de celda) y la direccion de la flecha.
    expect(map).toContain('"origin" "64 0 0"')
    expect(map).toContain('"direction"')
    expect(map).toContain('"angle"')
    // NO aporta geometria: el ancla no genera ninguna cara de brush.
    expect(map.split('\n').filter((l) => l.startsWith('(')).length).toBe(0)
  })

  it('un ancla SIN texto no emite entidad (un classname vacio no tiene sentido)', () => {
    const m = createModel()
    placeBlock(m, 'anchor', [0, 0, 0])
    const { map } = writeMap(serialize(m))
    expect(map).not.toContain('"origin"')
  })

  it('un ancla NO cuenta para la caja-mundo sellada (hull): solo envuelve la geometria solida', () => {
    const m = createModel()
    placeBlock(m, 'cube', [0, 0, 0])
    const a = placeBlock(m, 'anchor', [5, 0, 0]) // lejos del cubo
    setBlockLabel(m, a.id, 'side canons')
    const { map } = writeMap(serialize(m), { hull: true })
    // El ancla viaja como entidad...
    expect(map).toContain('"classname" "side canons"')
    // ...pero la caja sellada sigue siendo 6 losas (36 caras) + el cubo (6) = 42,
    // sin estirarse hasta el ancla lejano.
    expect(map.split('\n').filter((l) => l.startsWith('(')).length).toBe(42)
  })

  it('Modo clasico (lights8): rodea el modelo con 8 luces de punto SIN caja de sellado', () => {
    const m = createModel()
    placeBlock(m, 'cube', [0, 0, 0])
    const { map } = writeMap(serialize(m), { light: { lights8: 1 } })
    // 8 entidades light en las esquinas, cada una con su valor.
    const lights = (map.match(/"classname" "light"/g) || []).length
    expect(lights).toBe(8)
    expect(map).toContain('"light" "')
    // Modo clasico = modelo desnudo: NADA de caja sellada ni func_wall.
    expect(map).not.toContain('func_wall')
    expect(map).not.toContain('info_player_start')
    // Solo las 6 caras del cubo (las luces son entidades-punto, no brushes).
    expect(map.split('\n').filter((l) => l.startsWith('(')).length).toBe(6)
  })

  it('sin lights8 NO se emiten luces de punto', () => {
    const m = createModel()
    placeBlock(m, 'cube', [0, 0, 0])
    const { map } = writeMap(serialize(m))
    expect(map).not.toContain('"classname" "light"')
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
