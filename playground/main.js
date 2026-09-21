import { createMsdfAtlasGenerator } from "../dist/index.js";

const $ = (id) => document.getElementById(id);
let generator;
let atlasUrl;
let fontLoadId = 0;

async function getGenerator() {
  return generator ??= await createMsdfAtlasGenerator({
    workerUrl: new URL("../dist/msdf-atlas.worker.js", document.baseURI),
  });
}

async function readCharset(fontBytes) {
  return (await getGenerator()).getCharset(fontBytes);
}

function shader(gl, type, source) {
  const value = gl.createShader(type);
  gl.shaderSource(value, source);
  gl.compileShader(value);
  if (!gl.getShaderParameter(value, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(value));
  return value;
}

async function renderPhrase(png, metadata, phrase) {
  const canvas = $("preview");
  const gl = canvas.getContext("webgl", { alpha: false });
  if (!gl) throw new Error("WebGL no está disponible");
  if (!gl.getExtension("OES_standard_derivatives")) throw new Error("WebGL derivatives no están disponibles");
  const program = gl.createProgram();
  gl.attachShader(program, shader(gl, gl.VERTEX_SHADER, `
    attribute vec2 position; attribute vec2 uv; varying vec2 vUv;
    void main() { gl_Position=vec4(position,0.,1.); vUv=uv; }
  `));
  const distanceCode = metadata.atlas.type === "hardmask" || metadata.atlas.type === "softmask"
    ? "float a=texture2D(atlas,vUv).r;"
    : metadata.atlas.type === "sdf" || metadata.atlas.type === "psdf"
      ? "float d=texture2D(atlas,vUv).r-.5; float a=clamp(d/fwidth(d)+.5,0.,1.);"
      : "vec3 s=texture2D(atlas,vUv).rgb; float d=median(s.r,s.g,s.b)-.5; float a=clamp(d/fwidth(d)+.5,0.,1.);";
  gl.attachShader(program, shader(gl, gl.FRAGMENT_SHADER, `
    #extension GL_OES_standard_derivatives : enable
    precision mediump float; varying vec2 vUv; uniform sampler2D atlas;
    float median(float r,float g,float b){return max(min(r,g),min(max(r,g),b));}
    void main(){${distanceCode} gl_FragColor=vec4(mix(vec3(.08,.1,.15),vec3(.85,.91,1.),a),1.);}
  `));
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program));
  gl.useProgram(program);

  const blob = new Blob([png], { type: "image/png" });
  const image = await createImageBitmap(blob, { colorSpaceConversion: "none", premultiplyAlpha: "none" });
  const texture = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  const textureFormat = metadata.atlas.type === "mtsdf" ? gl.RGBA : metadata.atlas.type === "msdf" ? gl.RGB : gl.LUMINANCE;
  gl.texImage2D(gl.TEXTURE_2D, 0, textureFormat, textureFormat, gl.UNSIGNED_BYTE, image);

  const glyphs = new Map(metadata.glyphs.map((g) => [g.unicode, g]));
  const kern = new Map(metadata.kerning.map((k) => [`${k.unicode1}:${k.unicode2}`, k.advance]));
  const vertices = [];
  let pen = 28;
  const baseline = 112;
  const scale = metadata.atlas.size;
  const toClip = (x, y) => [2*x/canvas.width-1, 1-2*y/canvas.height];
  for (let i = 0; i < phrase.length; ++i) {
    const cp = phrase.codePointAt(i);
    if (cp > 0xffff) ++i;
    const glyph = glyphs.get(cp);
    if (!glyph) continue;
    if (glyph.planeBounds && glyph.atlasBounds) {
      const p = glyph.planeBounds, a = glyph.atlasBounds;
      const top = metadata.atlas.yOrigin === "top" ? p.top : -p.top;
      const bottom = metadata.atlas.yOrigin === "top" ? p.bottom : -p.bottom;
      const x0 = pen+p.left*scale, x1 = pen+p.right*scale;
      const y0 = baseline+top*scale, y1 = baseline+bottom*scale;
      const [cx0, cy0] = toClip(x0, y0), [cx1, cy1] = toClip(x1, y1);
      const u0 = a.left/metadata.atlas.width, u1 = a.right/metadata.atlas.width;
      const v0 = metadata.atlas.yOrigin === "top" ? a.top/metadata.atlas.height : 1-a.top/metadata.atlas.height;
      const v1 = metadata.atlas.yOrigin === "top" ? a.bottom/metadata.atlas.height : 1-a.bottom/metadata.atlas.height;
      vertices.push(cx0,cy0,u0,v0, cx1,cy0,u1,v0, cx0,cy1,u0,v1, cx0,cy1,u0,v1, cx1,cy0,u1,v0, cx1,cy1,u1,v1);
    }
    const next = phrase.codePointAt(i+1);
    pen += (glyph.advance+(kern.get(`${cp}:${next}`) ?? 0))*scale;
  }
  const buffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(vertices), gl.STATIC_DRAW);
  for (const [name, offset] of [["position", 0], ["uv", 2]]) {
    const loc = gl.getAttribLocation(program, name);
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 16, offset*4);
  }
  gl.viewport(0, 0, canvas.width, canvas.height);
  gl.clearColor(.035, .045, .07, 1);
  gl.clear(gl.COLOR_BUFFER_BIT);
  gl.drawArrays(gl.TRIANGLES, 0, vertices.length/4);
  image.close();
}

async function generate(fontBytes) {
  generator = await getGenerator();
  const started = performance.now();
  const result = await generator.generate(fontBytes, {
    charset: $("charset").value,
    type: $("type").value,
    size: Number($("size").value),
    pxRange: Number($("range").value),
    yOrigin: $("origin").value,
  });
  const elapsed = performance.now()-started;
  if (atlasUrl) URL.revokeObjectURL(atlasUrl);
  atlasUrl = URL.createObjectURL(new Blob([result.png], { type: "image/png" }));
  $("atlas").src = atlasUrl;
  $("metadata").textContent = JSON.stringify(result.metadata, null, 2);
  await renderPhrase(result.png, result.metadata, "AVATAR café Ω");
  $("status").textContent = `OK · ${result.metadata.atlas.type} · ${elapsed.toFixed(1)} ms · ${result.width}×${result.height} · ${(result.png.byteLength/1024).toFixed(1)} KiB PNG`;
  window.__atlasResult = result;
  return result;
}

$("font").addEventListener("change", async () => {
  const file = $("font").files[0];
  if (!file) return;
  const loadId = ++fontLoadId;
  $("status").textContent = "Leyendo caracteres de la fuente…";
  try {
    const charset = await readCharset(new Uint8Array(await file.arrayBuffer()));
    if (loadId === fontLoadId) {
      $("charset").value = charset;
      $("status").textContent = `Charset cargado · ${Array.from(charset).length.toLocaleString()} caracteres.`;
    }
  } catch (error) {
    if (loadId === fontLoadId) $("status").textContent = `Error: ${error.message}`;
  }
});

$("generate").addEventListener("click", async () => {
  const file = $("font").files[0];
  if (!file) return void ($("status").textContent = "Selecciona una fuente TTF/OTF.");
  $("status").textContent = "Generando…";
  try { await generate(new Uint8Array(await file.arrayBuffer())); }
  catch (error) { $("status").textContent = `Error: ${error.message}`; }
});

// Test-only hook: the normal demo never fetches a font.
const testFont = new URLSearchParams(location.search).get("testFont");
if (testFont) {
  $("status").textContent = "Ejecutando prueba…";
  fetch(testFont).then((r) => r.arrayBuffer()).then(async (b) => {
    const bytes = new Uint8Array(b);
    $("charset").value = await readCharset(bytes.slice());
    return generate(bytes);
  }).catch((e) => $("status").textContent = `Error: ${e.message}`);
}
