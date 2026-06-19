/**
 * Geometria compartida: transformacion de celda->mundo.
 *
 * Convencion de ejes: como Quake, Z es "arriba". Una celda ocupa el cubo
 * [-h, +h] en X/Y/Z (h = cellSize/2) centrado en el origen de la celda; su
 * centro en mundo es cell * cellSize.
 *
 * La rotacion de bloques vive en core/orientations.js (las 24 orientaciones
 * del cubo), no aqui.
 */

/** Centro de una celda en mundo. */
export function cellCenter(cell, cellSize) {
  return [cell[0] * cellSize, cell[1] * cellSize, cell[2] * cellSize]
}
