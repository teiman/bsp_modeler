/**
 * Rutas del lado servidor. El toolchain (qbsp/light/vis) y el directorio de
 * trabajo temporal. Por defecto el toolchain se busca en ./bin; se puede
 * sobreescribir con la variable de entorno BSP_BIN_DIR (p.ej. apuntando al
 * bin/ de editor-map mientras no copiemos los .exe).
 */

import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..', '..')

export const BIN_DIR = process.env.BSP_BIN_DIR || path.join(ROOT, 'bin')
export const TMP_DIR = path.join(ROOT, 'tmp')
export const TEXTURES_DIR = path.join(ROOT, 'textures')
export const ROOT_DIR = ROOT
