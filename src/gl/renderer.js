/**
 * Visor 3D WebGL del BSP Modeler. Adaptado del renderer de modules_editor
 * (camara orbital, rejilla, capa activa, fantasma, guia de caida) con dos
 * cambios propios:
 *   - la malla se construye con buildMesh (faces + atlas de texturas), no con
 *     una skin mdl,
 *   - picking de CARA (pickFace) para el modo de pintar texturas.
 *
 * Convencion de ejes: Z = arriba (como Quake).
 */

const VERT = `
attribute vec3 aPos;
attribute vec2 aUV;
attribute vec3 aNormal;
uniform mat4 uMVP;
varying vec2 vUV;
varying vec3 vNormal;
varying float vDist;
void main() {
  vec4 p = uMVP * vec4(aPos, 1.0);
  gl_Position = p;
  vUV = aUV;
  vNormal = aNormal;
  vDist = p.w;
}`

const FRAG = `
precision mediump float;
varying vec2 vUV;
varying vec3 vNormal;
varying float vDist;
uniform sampler2D uTex;
uniform vec3 uFogColor;
uniform float uFogNear;
uniform float uFogFar;
void main() {
  vec4 c = texture2D(uTex, vUV);
  vec3 n = normalize(vNormal);
  // Luz principal CENITAL (desde arriba) para leer bien el relieve: las caras
  // que miran al cielo se iluminan, las que miran abajo quedan en sombra.
  vec3 keyDir = normalize(vec3(0.25, -0.2, 1.0));
  float key = max(dot(n, keyDir), 0.0);
  // Ambiente hemisferico: gradiente cielo->suelo segun la inclinacion de la
  // normal en Z. Da volumen incluso a las caras no iluminadas directamente.
  float hemi = 0.5 + 0.5 * n.z;          // 1 arriba, 0.5 lateral, 0 abajo
  float lit = 0.35 + 0.55 * hemi + 0.55 * key;
  vec3 col = c.rgb * lit;
  float fog = clamp((vDist - uFogNear) / (uFogFar - uFogNear), 0.0, 1.0);
  col = mix(col, uFogColor, fog);
  gl_FragColor = vec4(col, 1.0);
}`

const LINE_VERT = `
attribute vec3 aPos;
uniform mat4 uMVP;
void main() { gl_Position = uMVP * vec4(aPos, 1.0); }`

const LINE_FRAG = `
precision mediump float;
uniform vec3 uColor;
uniform float uAlpha;
void main() { gl_FragColor = vec4(uColor, uAlpha); }`

const GHOST_VERT = `
attribute vec3 aPos;
attribute vec3 aNormal;
uniform mat4 uMVP;
varying vec3 vNormal;
void main() { gl_Position = uMVP * vec4(aPos, 1.0); vNormal = aNormal; }`

const GHOST_FRAG = `
precision mediump float;
varying vec3 vNormal;
uniform vec3 uColor;
uniform float uAlpha;
void main() {
  vec3 n = normalize(vNormal);
  float key = max(dot(n, normalize(vec3(0.25, -0.2, 1.0))), 0.0);
  float hemi = 0.5 + 0.5 * n.z;
  float lit = 0.35 + 0.55 * hemi + 0.55 * key;
  gl_FragColor = vec4(uColor * lit, uAlpha);
}`

function compile(gl, type, src) {
  const sh = gl.createShader(type)
  gl.shaderSource(sh, src)
  gl.compileShader(sh)
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) throw new Error('Shader: ' + gl.getShaderInfoLog(sh))
  return sh
}
function program(gl, v, f) {
  const p = gl.createProgram()
  gl.attachShader(p, compile(gl, gl.VERTEX_SHADER, v))
  gl.attachShader(p, compile(gl, gl.FRAGMENT_SHADER, f))
  gl.linkProgram(p)
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error('Program: ' + gl.getProgramInfoLog(p))
  return p
}

// --- Algebra 4x4 (column-major) ------------------------------------------------
function mat4Mul(a, b) {
  const o = new Array(16)
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++)
    o[c * 4 + r] = a[r] * b[c * 4] + a[4 + r] * b[c * 4 + 1] + a[8 + r] * b[c * 4 + 2] + a[12 + r] * b[c * 4 + 3]
  return o
}
function mat4Perspective(fovy, aspect, near, far) {
  const f = 1 / Math.tan(fovy / 2), nf = 1 / (near - far)
  return [f / aspect, 0, 0, 0, 0, f, 0, 0, 0, 0, (far + near) * nf, -1, 0, 0, 2 * far * near * nf, 0]
}
function mat4LookAt(eye, center, up) {
  const z = norm(sub(eye, center)), x = norm(cross(up, z)), y = cross(z, x)
  return [x[0], y[0], z[0], 0, x[1], y[1], z[1], 0, x[2], y[2], z[2], 0, -dot(x, eye), -dot(y, eye), -dot(z, eye), 1]
}
function sub(a, b) { return [a[0] - b[0], a[1] - b[1], a[2] - b[2]] }
function cross(a, b) { return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]] }
function dot(a, b) { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2] }
function norm(a) { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l] }

/** Interseccion rayo-triangulo (Moller-Trumbore). Devuelve t>=0 o null. */
function rayTri(orig, dir, a, b, c) {
  const e1 = sub(b, a), e2 = sub(c, a)
  const p = cross(dir, e2)
  const det = dot(e1, p)
  if (Math.abs(det) < 1e-7) return null
  const inv = 1 / det
  const t1 = sub(orig, a)
  const u = dot(t1, p) * inv
  if (u < 0 || u > 1) return null
  const q = cross(t1, e1)
  const vv = dot(dir, q) * inv
  if (vv < 0 || u + vv > 1) return null
  const t = dot(e2, q) * inv
  return t > 1e-4 ? t : null
}

function rayAABB(origin, dir, min, max) {
  let tmin = -Infinity, tmax = Infinity
  for (let i = 0; i < 3; i++) {
    if (Math.abs(dir[i]) < 1e-9) { if (origin[i] < min[i] || origin[i] > max[i]) return null }
    else {
      const inv = 1 / dir[i]
      let t1 = (min[i] - origin[i]) * inv, t2 = (max[i] - origin[i]) * inv
      if (t1 > t2) { const t = t1; t1 = t2; t2 = t }
      if (t1 > tmin) tmin = t1
      if (t2 < tmax) tmax = t2
      if (tmin > tmax) return null
    }
  }
  if (tmax < 0) return null
  return tmin >= 0 ? tmin : tmax
}

export class Renderer {
  constructor(canvas) {
    this.canvas = canvas
    const gl = canvas.getContext('webgl', { antialias: true, preserveDrawingBuffer: true })
    if (!gl) throw new Error('WebGL no disponible')
    this.gl = gl
    this.prog = program(gl, VERT, FRAG)
    this.lineProg = program(gl, LINE_VERT, LINE_FRAG)
    this.ghostProg = program(gl, GHOST_VERT, GHOST_FRAG)
    this.tex = gl.createTexture()
    this.meshBuf = gl.createBuffer()
    this.gridBuf = gl.createBuffer()
    this.layerGridBuf = gl.createBuffer()
    this.highlightBuf = gl.createBuffer()
    this.faceHiBuf = gl.createBuffer()
    this.ghostBuf = gl.createBuffer()
    this.shadowBuf = gl.createBuffer()
    this.guideBuf = gl.createBuffer()
    this.meshCount = 0; this.gridCount = 0; this.layerGridCount = 0
    this.highlightCount = 0; this.faceHiCount = 0; this.ghostCount = 0
    this.shadowCount = 0; this.guideCount = 0

    this.azimuth = Math.PI * 0.25
    this.elevation = Math.PI * 0.3
    this.distance = 160
    this.target = [0, 0, 0]
    this.focusZ = 0
    this._targetZ = 0

    // Mesh CPU-side, para picking de cara (triangulos + faceId por triangulo).
    this._tris = null // { positions:Float32Array, triFaceId:[] }

    gl.enable(gl.DEPTH_TEST)
    gl.clearColor(0.07, 0.06, 0.09, 1)
    gl.frontFace(gl.CCW)
  }

  /** Sube el atlas (canvas) como textura del modelo. */
  setAtlas(canvas) {
    const gl = this.gl
    gl.bindTexture(gl.TEXTURE_2D, this.tex)
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, canvas)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
  }

  /** Sube la malla construida por buildMesh ({ positions, uvs, normals, triFaceId }). */
  setMesh(mesh) {
    const gl = this.gl
    const n = mesh.triCount * 3
    const data = new Float32Array(n * 8)
    for (let i = 0; i < n; i++) {
      data[i * 8 + 0] = mesh.positions[i * 3 + 0]
      data[i * 8 + 1] = mesh.positions[i * 3 + 1]
      data[i * 8 + 2] = mesh.positions[i * 3 + 2]
      data[i * 8 + 3] = mesh.uvs[i * 2 + 0]
      data[i * 8 + 4] = mesh.uvs[i * 2 + 1]
      data[i * 8 + 5] = mesh.normals[i * 3 + 0]
      data[i * 8 + 6] = mesh.normals[i * 3 + 1]
      data[i * 8 + 7] = mesh.normals[i * 3 + 2]
    }
    gl.bindBuffer(gl.ARRAY_BUFFER, this.meshBuf)
    gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW)
    this.meshCount = n
    this._tris = { positions: mesh.positions, triFaceId: mesh.triFaceId }
  }

  _gridLines(gridSize, n, gz) {
    const half = gridSize / 2, ext = n * gridSize + half, lines = []
    for (let i = -n; i <= n + 1; i++) {
      const p = i * gridSize - half
      lines.push(-ext, p, gz, ext, p, gz)
      lines.push(p, -ext, gz, p, ext, gz)
    }
    return lines
  }
  setGrid(gridSize = 16, n = 8) {
    const gl = this.gl
    const lines = this._gridLines(gridSize, n, -gridSize / 2)
    gl.bindBuffer(gl.ARRAY_BUFFER, this.gridBuf)
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(lines), gl.STATIC_DRAW)
    this.gridCount = lines.length / 3
  }
  setLayerGrid(layer, gridSize = 16, n = 8) {
    const gl = this.gl
    if (!layer) { this.layerGridCount = 0; return }
    const lines = this._gridLines(gridSize, n, layer * gridSize - gridSize / 2)
    gl.bindBuffer(gl.ARRAY_BUFFER, this.layerGridBuf)
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(lines), gl.STATIC_DRAW)
    this.layerGridCount = lines.length / 3
  }
  _cellBoxLines(cell, gridSize) {
    const cx = cell[0] * gridSize, cy = cell[1] * gridSize, cz = cell[2] * gridSize, h = gridSize / 2
    const c = [
      [cx - h, cy - h, cz - h], [cx + h, cy - h, cz - h], [cx + h, cy + h, cz - h], [cx - h, cy + h, cz - h],
      [cx - h, cy - h, cz + h], [cx + h, cy - h, cz + h], [cx + h, cy + h, cz + h], [cx - h, cy + h, cz + h],
    ]
    const edges = [[0, 1], [1, 2], [2, 3], [3, 0], [4, 5], [5, 6], [6, 7], [7, 4], [0, 4], [1, 5], [2, 6], [3, 7]]
    const lines = []
    for (const [a, b] of edges) lines.push(...c[a], ...c[b])
    return lines
  }
  setHighlight(cell, gridSize = 16) {
    const gl = this.gl
    if (!cell) { this.highlightCount = 0; return }
    const lines = this._cellBoxLines(cell, gridSize)
    gl.bindBuffer(gl.ARRAY_BUFFER, this.highlightBuf)
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(lines), gl.STATIC_DRAW)
    this.highlightCount = lines.length / 3
  }
  /** Resalta una cara concreta (poligono) — relleno translucido. verts o null. */
  setFaceHighlight(verts) {
    const gl = this.gl
    if (!verts || verts.length < 3) { this.faceHiCount = 0; return }
    const tris = []
    for (let i = 1; i < verts.length - 1; i++) tris.push(...verts[0], ...verts[i], ...verts[i + 1])
    gl.bindBuffer(gl.ARRAY_BUFFER, this.faceHiBuf)
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(tris), gl.STATIC_DRAW)
    this.faceHiCount = tris.length / 3
  }
  setDropGuide(cell, gridSize = 16) {
    const gl = this.gl
    if (!cell) { this.shadowCount = 0; this.guideCount = 0; return }
    const cx = cell[0] * gridSize, cy = cell[1] * gridSize, cz = cell[2] * gridSize, h = gridSize / 2
    const floor = -h, zf = floor + 0.05
    const q0 = [cx - h, cy - h, zf], q1 = [cx + h, cy - h, zf], q2 = [cx + h, cy + h, zf], q3 = [cx - h, cy + h, zf]
    const shadow = [...q0, ...q1, ...q2, ...q0, ...q2, ...q3]
    gl.bindBuffer(gl.ARRAY_BUFFER, this.shadowBuf)
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(shadow), gl.STATIC_DRAW)
    this.shadowCount = shadow.length / 3
    const guide = [cx, cy, cz - h, cx, cy, floor]
    gl.bindBuffer(gl.ARRAY_BUFFER, this.guideBuf)
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(guide), gl.STATIC_DRAW)
    this.guideCount = 2
  }
  setGhost(verts) {
    const gl = this.gl
    if (!verts || verts.length === 0) { this.ghostCount = 0; return }
    gl.bindBuffer(gl.ARRAY_BUFFER, this.ghostBuf)
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(verts), gl.STATIC_DRAW)
    this.ghostCount = verts.length / 6
  }

  cameraEye() {
    const ce = Math.cos(this.elevation), se = Math.sin(this.elevation)
    const ca = Math.cos(this.azimuth), sa = Math.sin(this.azimuth)
    return [
      this.target[0] + this.distance * ce * ca,
      this.target[1] + this.distance * ce * sa,
      this.target[2] + this.distance * se,
    ]
  }
  viewProj() {
    const aspect = this.canvas.width / Math.max(1, this.canvas.height)
    return mat4Mul(mat4Perspective(Math.PI / 4, aspect, 1, 6000), mat4LookAt(this.cameraEye(), this.target, [0, 0, 1]))
  }
  setFocusHeight(z) { this.focusZ = z }

  render() {
    const gl = this.gl
    const w = this.canvas.clientWidth, h = this.canvas.clientHeight
    if (this.canvas.width !== w || this.canvas.height !== h) { this.canvas.width = w; this.canvas.height = h }
    this._targetZ += (this.focusZ - this._targetZ) * 0.15
    this.target[2] = this._targetZ
    gl.viewport(0, 0, this.canvas.width, this.canvas.height)
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT)
    const mvp = this.viewProj()

    if (this.meshCount > 0) {
      gl.useProgram(this.prog)
      gl.uniformMatrix4fv(gl.getUniformLocation(this.prog, 'uMVP'), false, new Float32Array(mvp))
      gl.uniform3f(gl.getUniformLocation(this.prog, 'uFogColor'), 0.16, 0.14, 0.20)
      gl.uniform1f(gl.getUniformLocation(this.prog, 'uFogNear'), this.distance * 0.6)
      gl.uniform1f(gl.getUniformLocation(this.prog, 'uFogFar'), this.distance * 2.0)
      gl.activeTexture(gl.TEXTURE0)
      gl.bindTexture(gl.TEXTURE_2D, this.tex)
      gl.uniform1i(gl.getUniformLocation(this.prog, 'uTex'), 0)
      gl.bindBuffer(gl.ARRAY_BUFFER, this.meshBuf)
      const aPos = gl.getAttribLocation(this.prog, 'aPos')
      const aUV = gl.getAttribLocation(this.prog, 'aUV')
      const aNormal = gl.getAttribLocation(this.prog, 'aNormal')
      gl.enableVertexAttribArray(aPos); gl.vertexAttribPointer(aPos, 3, gl.FLOAT, false, 32, 0)
      gl.enableVertexAttribArray(aUV); gl.vertexAttribPointer(aUV, 2, gl.FLOAT, false, 32, 12)
      gl.enableVertexAttribArray(aNormal); gl.vertexAttribPointer(aNormal, 3, gl.FLOAT, false, 32, 20)
      gl.enable(gl.CULL_FACE); gl.cullFace(gl.BACK)
      gl.drawArrays(gl.TRIANGLES, 0, this.meshCount)
      gl.disable(gl.CULL_FACE)
    }

    gl.useProgram(this.lineProg)
    gl.uniformMatrix4fv(gl.getUniformLocation(this.lineProg, 'uMVP'), false, new Float32Array(mvp))
    const aPosL = gl.getAttribLocation(this.lineProg, 'aPos')
    const uColorL = gl.getUniformLocation(this.lineProg, 'uColor')
    const uAlphaL = gl.getUniformLocation(this.lineProg, 'uAlpha')
    const drawArr = (buf, count, mode) => {
      gl.bindBuffer(gl.ARRAY_BUFFER, buf)
      gl.enableVertexAttribArray(aPosL); gl.vertexAttribPointer(aPosL, 3, gl.FLOAT, false, 0, 0)
      gl.drawArrays(mode, 0, count)
    }

    if (this.gridCount > 0 && this.layerGridCount === 0) {
      gl.uniform3f(uColorL, 0.28, 0.26, 0.34); gl.uniform1f(uAlphaL, 1.0)
      drawArr(this.gridBuf, this.gridCount, gl.LINES)
    }
    if (this.layerGridCount > 0) {
      gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA)
      gl.uniform3f(uColorL, 0.32, 0.32, 0.35); gl.uniform1f(uAlphaL, 0.45)
      drawArr(this.layerGridBuf, this.layerGridCount, gl.LINES)
      gl.disable(gl.BLEND)
    }
    if (this.shadowCount > 0 || this.guideCount > 0) {
      gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA)
      gl.uniform3f(uColorL, 1.0, 0.3, 0.28)
      if (this.guideCount > 0) { gl.uniform1f(uAlphaL, 0.5); drawArr(this.guideBuf, this.guideCount, gl.LINES) }
      if (this.shadowCount > 0) { gl.uniform1f(uAlphaL, 0.4); drawArr(this.shadowBuf, this.shadowCount, gl.TRIANGLES) }
      gl.disable(gl.BLEND)
    }
    // Cara resaltada para pintar: relleno cian translucido.
    if (this.faceHiCount > 0) {
      gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA)
      gl.depthMask(false)
      gl.uniform3f(uColorL, 0.3, 0.85, 1.0); gl.uniform1f(uAlphaL, 0.4)
      drawArr(this.faceHiBuf, this.faceHiCount, gl.TRIANGLES)
      gl.depthMask(true); gl.disable(gl.BLEND)
    }
    if (this.highlightCount > 0) {
      gl.uniform3f(uColorL, 0.9, 0.2, 0.22); gl.uniform1f(uAlphaL, 1.0)
      drawArr(this.highlightBuf, this.highlightCount, gl.LINES)
    }

    if (this.ghostCount > 0) {
      gl.useProgram(this.ghostProg)
      gl.uniformMatrix4fv(gl.getUniformLocation(this.ghostProg, 'uMVP'), false, new Float32Array(mvp))
      gl.uniform3f(gl.getUniformLocation(this.ghostProg, 'uColor'), 0.95, 0.85, 0.55)
      gl.uniform1f(gl.getUniformLocation(this.ghostProg, 'uAlpha'), 0.45)
      gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA); gl.depthMask(false)
      gl.bindBuffer(gl.ARRAY_BUFFER, this.ghostBuf)
      const gPos = gl.getAttribLocation(this.ghostProg, 'aPos')
      const gNor = gl.getAttribLocation(this.ghostProg, 'aNormal')
      gl.enableVertexAttribArray(gPos); gl.vertexAttribPointer(gPos, 3, gl.FLOAT, false, 24, 0)
      gl.enableVertexAttribArray(gNor); gl.vertexAttribPointer(gNor, 3, gl.FLOAT, false, 24, 12)
      gl.drawArrays(gl.TRIANGLES, 0, this.ghostCount)
      gl.depthMask(true); gl.disable(gl.BLEND)
    }
  }

  pickRay(px, py) {
    const rect = this.canvas.getBoundingClientRect()
    const x = (px / rect.width) * 2 - 1, y = -((py / rect.height) * 2 - 1)
    const eye = this.cameraEye()
    const aspect = rect.width / Math.max(1, rect.height)
    const tanF = Math.tan(Math.PI / 8)
    const camDir = [x * tanF * aspect, y * tanF, -1]
    const fwd = norm(sub(this.target, eye))
    const right = norm(cross(fwd, [0, 0, 1]))
    const up = cross(right, fwd)
    const dir = norm([
      camDir[0] * right[0] + camDir[1] * up[0] - camDir[2] * fwd[0],
      camDir[0] * right[1] + camDir[1] * up[1] - camDir[2] * fwd[1],
      camDir[0] * right[2] + camDir[1] * up[2] - camDir[2] * fwd[2],
    ])
    return { origin: eye, dir }
  }
  pickGroundPoint(px, py, zPlane = 0) {
    const { origin: eye, dir } = this.pickRay(px, py)
    if (Math.abs(dir[2]) < 1e-6) return null
    const t = (zPlane - eye[2]) / dir[2]
    if (t < 0) return null
    return [eye[0] + dir[0] * t, eye[1] + dir[1] * t, zPlane]
  }
  pickBlock(px, py, blocks, gridSize = 16) {
    const { origin, dir } = this.pickRay(px, py)
    const h = gridSize / 2
    let best = null, bestT = Infinity
    for (const b of blocks) {
      const cx = b.cell[0] * gridSize, cy = b.cell[1] * gridSize, cz = b.cell[2] * gridSize
      const t = rayAABB(origin, dir, [cx - h, cy - h, cz - h], [cx + h, cy + h, cz + h])
      if (t !== null && t < bestT) { bestT = t; best = b }
    }
    return best
  }
  /**
   * Picking de CARA: lanza un rayo y devuelve el faceId del triangulo mas
   * cercano impactado (modo pintar). null si no impacta nada.
   */
  pickFace(px, py) {
    if (!this._tris) return null
    const { origin, dir } = this.pickRay(px, py)
    const P = this._tris.positions, ids = this._tris.triFaceId
    let best = null, bestT = Infinity
    for (let i = 0; i < ids.length; i++) {
      const o = i * 9
      const a = [P[o], P[o + 1], P[o + 2]]
      const b = [P[o + 3], P[o + 4], P[o + 5]]
      const c = [P[o + 6], P[o + 7], P[o + 8]]
      const t = rayTri(origin, dir, a, b, c)
      if (t !== null && t < bestT) { bestT = t; best = ids[i] }
    }
    return best
  }
  orbit(dAz, dEl) { this.azimuth += dAz; this.elevation = Math.max(-1.4, Math.min(1.4, this.elevation + dEl)) }
  zoom(factor) { this.distance = Math.max(20, Math.min(2000, this.distance * factor)) }
}
