// web-ambient tiny WebGL helpers: context, programs, full-screen triangle, render targets.
// Every created GL object is counted, so health() can prove the counts stay constant over long play.

export const glCount = { programs: 0, shaders: 0, buffers: 0, textures: 0, framebuffers: 0 };
export function glObjects() {
  return glCount.programs + glCount.shaders + glCount.buffers + glCount.textures + glCount.framebuffers;
}
export function resetCounts() { for (const k in glCount) glCount[k] = 0; }

// WebGL2, then WebGL1, else null (the caller shows the poster).
export function getContext(canvas, attrs) {
  const a = Object.assign({ alpha: false, antialias: false, depth: false, stencil: false,
    premultipliedAlpha: false, preserveDrawingBuffer: false, powerPreference: 'default' }, attrs || {});
  let gl = null, version = 0;
  try { gl = canvas.getContext('webgl2', a); if (gl) version = 2; } catch (e) { gl = null; }
  if (!gl) { try { gl = canvas.getContext('webgl', a); if (gl) version = 1; } catch (e) { gl = null; } }
  return gl ? { gl, version } : null;
}

function compile(gl, type, src) {
  const sh = gl.createShader(type);
  glCount.shaders++;
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS) && !gl.isContextLost()) {
    const log = gl.getShaderInfoLog(sh);
    gl.deleteShader(sh); glCount.shaders--;
    throw new Error('shader compile failed: ' + log);
  }
  return sh;
}

// Program from vertex + fragment source. Shaders are deleted after linking. Returns { prog, loc(name) }.
export function program(gl, vsSrc, fsSrc) {
  const vs = compile(gl, gl.VERTEX_SHADER, vsSrc), fs = compile(gl, gl.FRAGMENT_SHADER, fsSrc);
  const prog = gl.createProgram();
  glCount.programs++;
  gl.attachShader(prog, vs); gl.attachShader(prog, fs);
  gl.bindAttribLocation(prog, 0, 'aPos');
  gl.linkProgram(prog);
  gl.deleteShader(vs); gl.deleteShader(fs); glCount.shaders -= 2;
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS) && !gl.isContextLost()) {
    const log = gl.getProgramInfoLog(prog);
    gl.deleteProgram(prog); glCount.programs--;
    throw new Error('program link failed: ' + log);
  }
  const cache = new Map();
  return {
    prog,
    loc(name) {
      if (!cache.has(name)) cache.set(name, gl.getUniformLocation(prog, name));
      return cache.get(name);
    },
  };
}

// Vertex shader for a full-screen triangle; vUv in [0,1]. Works in WebGL1 and WebGL2 (GLSL ES 1.00).
export const FULLSCREEN_VS = `attribute vec2 aPos; varying vec2 vUv;
void main() { vUv = aPos * 0.5 + 0.5; gl_Position = vec4(aPos, 0.0, 1.0); }`;

// One buffer with a triangle covering the viewport, bound to attribute 0.
export function fullscreenTriangle(gl) {
  const buf = gl.createBuffer();
  glCount.buffers++;
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  return {
    draw() {
      gl.bindBuffer(gl.ARRAY_BUFFER, buf);
      gl.enableVertexAttribArray(0);
      gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    },
    dispose() { gl.deleteBuffer(buf); glCount.buffers--; },
  };
}

// RGBA8 render target (linear filtered). resize() reuses the same texture and framebuffer.
export function renderTarget(gl, w, h) {
  const tex = gl.createTexture(), fb = gl.createFramebuffer();
  glCount.textures++; glCount.framebuffers++;
  const rt = {
    tex, fb, w: 0, h: 0,
    resize(nw, nh) {
      nw = Math.max(1, nw | 0); nh = Math.max(1, nh | 0);
      if (nw === rt.w && nh === rt.h) return;
      rt.w = nw; rt.h = nh;
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, nw, nh, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    },
    bind() { gl.bindFramebuffer(gl.FRAMEBUFFER, fb); gl.viewport(0, 0, rt.w, rt.h); },
    dispose() { gl.deleteTexture(tex); gl.deleteFramebuffer(fb); glCount.textures--; glCount.framebuffers--; },
  };
  rt.resize(w, h);
  return rt;
}
