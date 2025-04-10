import { mat2d, mat3, vec2 } from "gl-matrix";
import { Transform } from "./transforms";
import * as Zen from "./zen";

async function init() {
  Zen.defineAttribute(Draw);
  Zen.defineAttribute(DrawGroup);

  const canvas = document.querySelector("#zen-app")! as HTMLCanvasElement;
  canvas.style.width = "100%";
  canvas.style.height = "100%";

  const gl = canvas.getContext("webgl2");
  if (!gl) throw new Error("failed to get webgl2 context");

  gl.clearColor(0.07, 0.07, 0.07, 1);
  gl.clear(gl.COLOR_BUFFER_BIT);

  const vp = Zen.createResource(Viewport, new Viewport(gl));
  vp.zoom = 0.01;

  new ResizeObserver(onResize).observe(canvas, { box: "content-box" });

  Zen.createSystem(
    { with: [Draw], resources: [Viewport] },
    { foreach: enqueueDraw, once: draw },
  );
}

export class Viewport {
  resolution: vec2 = [0, 0];
  screen: vec2 = [0, 0];
  transform: Transform = new Transform({ pivot: [0.5, 0.5] });
  zoom: number = 1;
  gl: WebGL2RenderingContext;

  private renderTextures: Map<string, RenderTexture>;
  //TODO depth and stencil render buffers

  constructor(gl: WebGL2RenderingContext) {
    this.gl = gl;

    this.renderTextures = new Map();
    this.renderTextures.set("COLOR", new RenderTexture(gl, "rgba8", 1, true));
  }

  updateScale() {
    this.transform.scale = [
      this.zoom * this.resolution[0],
      this.zoom * this.resolution[1],
    ];
  }

  createRenderTexture(
    name: string,
    format: TextureFormat,
    resolution: number,
    swappable: boolean,
  ): RenderTexture {
    const rt = this.renderTextures.get(name);

    if (
      rt &&
      rt.format === format &&
      rt.resolution === resolution &&
      rt.isSwappable() === swappable
    ) {
      return rt;
    }

    const newRt = new RenderTexture(this.gl, format, resolution, swappable);
    this.renderTextures.set(name, newRt);
    return newRt;
  }

  screenToWorld(screenPos: vec2): vec2 {
    // normalize coordinates
    const spos = vec2.clone(screenPos);
    spos[0] /= this.screen[0];
    spos[1] /= this.screen[1];

    const worldPos = vec2.create();
    const trs = this.transform.trs();
    return vec2.transformMat2d(worldPos, spos, trs);
  }

  worldToScreen(worldPos: vec2): vec2 {
    const screenPos = vec2.create();
    const trs = this.transform.trs();
    mat2d.invert(trs, trs);
    vec2.transformMat2d(screenPos, worldPos, trs);

    // scale coordinates
    screenPos[0] *= this.screen[0];
    screenPos[1] *= this.screen[1];

    return screenPos;
  }
}

function enqueueDraw(e: Zen.Entity) {
  const d = e.getAttribute<Draw>(Draw)!;

  // TRANSFORM built-in property
  // required for all non-fullscreen shaders
  const t = e.getAttribute<Transform>(Transform);
  if (d.group.shader.mode === "world" && !t) {
    console.log("ERROR: world shaders require a Transform attribute");
    return;
  }

  if (t) d.group.propertyValues.push(...mat3.fromMat2d(mat3.create(), t.trs()));

  // add value to property data buffer
  for (const p of d.properties) {
    if (p.type === "float") d.group.propertyValues.push(p.value);
    else d.group.propertyValues.push(...p.value);
  }

  d.group.instanceCount++;
}

function draw() {
  const q = Zen.query({ with: [DrawGroup] });

  const vp = Zen.getResource<Viewport>(Viewport);
  if (!vp) return;

  vp.updateScale();

  const t = Zen.getResource<Zen.Time>(Zen.Time);
  if (!t) return;

  // sort draw groups by drawOrder, smallest drawOrder renders first
  const groups: DrawGroup[] = [];
  for (let i = 0; i < q.length; i++) {
    groups.push(q[i].getAttribute<DrawGroup>(DrawGroup)!);
  }
  groups.sort((a, b) => a.drawOrder - b.drawOrder);

  // prepare and dispatch an instanced draw call for each draw group
  // TODO replace with group.draw()
  for (let i = 0; i < groups.length; i++) {
    const group = groups[i];

    vp.gl.useProgram(group.shader.program);
    vp.gl.bindVertexArray(group.vao);

    const vpTRS = vp.transform.trs();
    const vpTRSI = mat2d.create();
    mat2d.invert(vpTRSI, vpTRS);

    group.setMatrixUniform(
      "SCREEN_TO_WORLD",
      mat3.fromMat2d(mat3.create(), vpTRS),
    );

    group.setMatrixUniform(
      "WORLD_TO_SCREEN",
      mat3.fromMat2d(mat3.create(), vpTRSI),
    );

    // update uniform values
    for (const u of Object.values(group.uniformValues)) {
      switch (u.value.type) {
        case "float":
          vp.gl.uniform1f(u.uniform.location, u.value.value);
          break;
        case "vec2":
          vp.gl.uniform2fv(u.uniform.location, u.value.value);
          break;
        case "mat3":
          vp.gl.uniformMatrix3fv(u.uniform.location, false, u.value.value);
          break;
      }
    }

    vp.gl.bindBuffer(vp.gl.ARRAY_BUFFER, group.modelBuffer);
    vp.gl.bufferData(vp.gl.ARRAY_BUFFER, rectVerts, vp.gl.STATIC_DRAW);

    vp.gl.bindBuffer(vp.gl.ARRAY_BUFFER, group.instanceBuffer.buffer);
    vp.gl.bufferData(
      vp.gl.ARRAY_BUFFER,
      new Float32Array(group.propertyValues),
      vp.gl.STATIC_DRAW,
    );

    vp.gl.drawArraysInstanced(vp.gl.TRIANGLES, 0, 6, group.instanceCount);
    vp.gl.bindVertexArray(null);

    group.instanceCount = 0;
    group.propertyValues = [];
  }
}

type ShaderMode = "world" | "fullscreen";

export class Shader {
  program: WebGLProgram;
  mode: ShaderMode;
  uniforms: Uniform[] = [];
  properties: Property[] = [];
  outputs: Output[] = [];

  constructor(
    source: string,
    mode: ShaderMode,
    options?: {
      properties?: Record<string, GLType>;
      uniforms?: Record<string, GLType | GLSamplerType>;
      outputs?: Record<string, GLOutputType>;
    },
  ) {
    const gl = Zen.getResource<Viewport>(Viewport)?.gl;
    if (!gl) throw new Error("failed to get renderer");

    this.mode = mode;

    // add uniforms
    this.uniforms.push({ name: "WORLD_TO_SCREEN", type: "mat3", location: 0 });
    this.uniforms.push({ name: "SCREEN_TO_WORLD", type: "mat3", location: 0 });
    //TODO TIME, DELTA_TIME, SCREEN_COLOR
    for (const [name, type] of Object.entries(options?.uniforms || {})) {
      this.uniforms.push({ name, type, location: 0 });
    }

    // add properties
    this.properties.push({ name: "TRANSFORM", type: "mat3", location: 0 });
    for (const [name, type] of Object.entries(options?.properties || {})) {
      this.properties.push({ name, type, location: 0 });
    }

    // add outputs
    this.outputs.push({ name: "COLOR", type: "vec4", location: 0 });
    for (const [name, type] of Object.entries(options?.outputs || {})) {
      this.outputs.push({ name, type, location: 0 });
    }

    const vertSrc = vertSource(this);
    // console.log(vertSrc);

    const vert = compileShader(gl, true, vertSrc);
    const frag = compileShader(gl, false, source);

    const program = gl.createProgram();
    gl.attachShader(program, vert);
    gl.attachShader(program, frag);
    gl.linkProgram(program);
    const success = gl.getProgramParameter(program, gl.LINK_STATUS);

    if (!success) {
      console.log(gl.getProgramInfoLog(program));
      gl.deleteProgram(program);
      throw new Error("failed to create gl program");
    }

    // get uniform locations
    for (const u of this.uniforms) {
      u.location = gl.getUniformLocation(program, u.name)!;
    }

    // get property locations
    for (const p of this.properties) {
      p.location = gl.getAttribLocation(program, p.name)!;
    }

    // get output locations
    for (const o of this.properties) {
      o.location = gl.getFragDataLocation(program, o.name)!;
    }

    this.program = program;
  }
}

function compileShader(
  gl: WebGL2RenderingContext,
  vert: boolean,
  source: string,
): WebGLShader {
  let shader = gl.createShader(vert ? gl.VERTEX_SHADER : gl.FRAGMENT_SHADER)!;

  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  const success = gl.getShaderParameter(shader, gl.COMPILE_STATUS);
  if (success) return shader;

  console.log(gl.getShaderInfoLog(shader));
  gl.deleteShader(shader);
  throw new Error(`failed to create shader`);
}

type GLType = "float" | "vec2" | "mat3";
type GLValue = FloatValue | Vec2Value | Mat3Value;
type GLSamplerType = "sampler2D" | "sampler2DArray";
type GLOutputType = "float" | "vec4"; //TODO support more types
type TextureFormat = "rgba8"; //TODO support more formats

// prettier-ignore
type TextureSize = 1 | 2 | 4 | 8 | 16 | 32 | 64 | 128 | 256 | 512 | 1024 | 2048 | 4096;

interface FloatValue {
  type: "float";
  value: number;
}

interface Vec2Value {
  type: "vec2";
  value: vec2;
}

interface Mat3Value {
  type: "mat3";
  value: mat3;
}

interface Property {
  name: string;
  type: GLType;
  location: number;
}

interface Output {
  name: string;
  type: GLOutputType;
  location: number;
}

interface Uniform {
  name: string;
  type: GLType | GLSamplerType;
  location: WebGLUniformLocation;
}

type Texture = TextureArray | RenderTexture;
type TextureSource = HTMLImageElement | Uint8ClampedArray;

class TextureArray {
  size: TextureSize;
  layers: number;
  unit: number | null = null;
  //TODO mipmap settings

  private data: Uint8ClampedArray;
  private texture: WebGLTexture;

  constructor(size: TextureSize, layers: number, sources: TextureSource[]) {
    const vp = Zen.getResource<Viewport>(Viewport);
    if (!vp) throw new Error("viewport undefined");

    const tex = vp.gl.createTexture();
    vp.gl.bindTexture(vp.gl.TEXTURE_2D_ARRAY, tex);
    //TODO upload texture array data from source (treat as atlas)
    vp.gl.bindTexture(vp.gl.TEXTURE_2D_ARRAY, null);

    this.size = size;
    this.layers = layers;
    this.data = new Uint8ClampedArray();
    this.texture = tex;
  }

  //TODO
  // get(x, y, depth): vec4
  // set(x, y, depth, vec4)
}

class RenderTexture {
  format: TextureFormat;
  resolution: number;
  unit: number | null = null;
  //TODO mipmap settings

  private texture: WebGLTexture;
  private altTexture: WebGLTexture | null;

  constructor(
    gl: WebGL2RenderingContext,
    format: TextureFormat,
    resolution: number,
    swappable: boolean,
  ) {
    this.format = format;
    this.resolution = resolution;
    this.texture = gl.createTexture();
    this.altTexture = swappable ? gl.createTexture() : null;
  }

  isSwappable(): boolean {
    return this.altTexture !== null;
  }

  borrow(mutable: boolean): TextureRef {
    //TODO borrow check behavior
    //TODO allow 1 write access and N read accesses
    //TODO reference counting
    return { texture: this.texture, mutable };
  }

  return(ref: TextureRef) {
    //TODO if swappable, automate swap behavior on mutable return
  }

  //TODO
  // get(x, y): vec4
  // set(x, y, vec4)
}

interface TextureRef {
  texture: WebGLTexture;
  mutable: boolean;
}

function getPropertySize(p: Property): number {
  switch (p.type) {
    case "float":
      return 1;
    case "vec2":
      return 2;
    case "mat3":
      return 9;
  }
}

export class Draw {
  group: DrawGroup;
  properties: GLValue[] = [];

  constructor(group: DrawGroup) {
    this.group = group;
  }

  setNumberProperty(name: string, value: number): Draw {
    return this.setProperty(name, { type: "float", value });
  }

  setVectorProperty(name: string, value: vec2): Draw {
    return this.setProperty(name, { type: "vec2", value });
  }

  setMatrixProperty(name: string, value: mat3): Draw {
    return this.setProperty(name, { type: "mat3", value });
  }

  private setProperty(name: string, value: GLValue): Draw {
    const idx = this.group.shader.properties.findIndex((p) => p.name === name);
    if (idx < 0) {
      console.log(`WARNING: undefined property '${name}'`);
      return this;
    }

    this.properties[idx] = value;
    return this;
  }
}

export class DrawGroup {
  gl: WebGL2RenderingContext;
  shader: Shader;
  vao: WebGLVertexArrayObject;
  modelBuffer: WebGLBuffer;
  instanceBuffer: BufferFormat;
  instanceCount: number = 0;
  drawOrder: number = 0;
  uniformValues: Record<string, UniformValue> = {};
  samplerSettings: Record<string, SamplerSettings> = {};
  propertyValues: number[] = [];

  private framebuffer: WebGLFramebuffer;
  private textureArrays: Record<string, TextureArray> = {};
  private pipelineInputs: RenderTexture[] = [];
  private pipelineOutputs: RenderTexture[] = [];
  private depthBuffer: WebGLRenderbuffer | null = null;
  private stencilBuffer: WebGLRenderbuffer | null = null;

  constructor(shader: Shader) {
    const gl = Zen.getResource<Viewport>(Viewport)?.gl;
    if (!gl) throw new Error("failed to get renderer");

    const vao = gl.createVertexArray();
    gl.bindVertexArray(vao);
    const modelBuffer = rectModelBuffer(gl, shader);
    const instanceBuffer = new BufferFormat(gl, shader);
    gl.bindVertexArray(null);

    const fb = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
    //TODO configure framebuffer
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);

    this.gl = gl;
    this.shader = shader;
    this.vao = vao;
    this.modelBuffer = modelBuffer;
    this.instanceBuffer = instanceBuffer;
    this.framebuffer = fb;
  }

  setNumberUniform(name: string, value: number): DrawGroup {
    this.setUniform(name, { type: "float", value });
    return this;
  }

  setVectorUniform(name: string, value: vec2): DrawGroup {
    this.setUniform(name, { type: "vec2", value });
    return this;
  }

  setMatrixUniform(name: string, value: mat3): DrawGroup {
    this.setUniform(name, { type: "mat3", value });
    return this;
  }

  private setUniform(name: string, value: GLValue) {
    const u = this.shader.uniforms.find((u) => u.name === name);
    if (!u) {
      console.log(`WARNING: undefined uniform '${name}'`);
      return this;
    }

    this.uniformValues[name] = { uniform: u, value };
  }

  setTexture(name: string, value: TextureArray): DrawGroup {
    const u = this.shader.uniforms.find((u) => u.name === name);
    if (!u || (u.type !== "sampler2D" && u.type !== "sampler2DArray")) {
      console.log(`WARNING: texture array missing sampler '${name}'`);
      return this;
    }

    this.textureArrays[name] = value;

    return this;
  }

  draw() {
    //TODO bind objects (program, vao, framebuffer)
    //TODO borrow RenderTexture references
    //TODO bind textures to texture units
    //TODO update sampler uniform values
    //TODO upload sampler parameters
    //TODO update builtin uniform values
    //TODO upload uniform values
    //TODO upload model/instance buffer data
    //TODO dispatch instanced draw call
    //TODO return RenderTexture references
    //TODO unbind objects
    //TODO clear instanceCount and propertyValues state
  }
}

interface UniformValue {
  uniform: Uniform;
  value: GLValue;
}

type FilterMode = "nearest" | "linear";

interface SamplerSettings {
  sampler: Uniform;
  wrapMode: "clamp" | "repeat";
  minFilterMode: FilterMode;
  magFilterMode: FilterMode;
  mipmapMode: FilterMode;
}

export class BufferFormat {
  buffer: WebGLBuffer;
  stride: number;

  constructor(gl: WebGL2RenderingContext, shader: Shader) {
    let buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);

    // number of f32s per instance
    let stride = 0;

    // set up attributes
    for (const p of Object.values(shader.properties)) {
      if (p.location < 0) continue;

      const rows = p.type === "mat3" ? 3 : 1;
      const totalElements = getPropertySize(p);
      const cols = totalElements / rows;

      // handles matrix attribute sub-fields
      for (let j = 0; j < rows; j++) {
        gl.enableVertexAttribArray(p.location + j);
        gl.vertexAttribDivisor(p.location + j, 1);

        gl.vertexAttribPointer(
          p.location + j,
          cols, // can be 1-4 (elements)
          gl.FLOAT, // 32-bit float
          false, // do not normalize
          totalElements * 4, // size * sizeof(type)
          stride * 4, // buffer byte offset
        );

        stride += cols;
      }
    }

    this.buffer = buf;
    this.stride = stride;
  }
}

// adapted from WebGl2Fundementals
// https://webgl2fundamentals.org/webgl/lessons/webgl-resizing-the-canvas.html
function onResize(entries: ResizeObserverEntry[]) {
  for (const entry of entries) {
    const vp = Zen.getResource<Viewport>(Viewport);
    if (!vp || entry.target !== vp.gl.canvas) continue;

    const size = entry.devicePixelContentBoxSize[0];
    const displayWidth = Math.round(size.inlineSize);
    const displayHeight = Math.round(size.blockSize);

    vp.resolution[0] = displayWidth;
    vp.resolution[1] = displayHeight;
    vp.screen[0] = displayWidth / window.devicePixelRatio;
    vp.screen[1] = displayHeight / window.devicePixelRatio;
    vp.updateScale();

    const needResize =
      vp.gl.canvas.width !== displayWidth ||
      vp.gl.canvas.height !== displayHeight;

    if (needResize) {
      vp.gl.canvas.width = displayWidth;
      vp.gl.canvas.height = displayHeight;
      vp.gl.viewport(0, 0, displayWidth, displayHeight);
    }
  }
}

const rectVerts = new Float32Array([0, 0, 1, 0, 1, 1, 0, 0, 0, 1, 1, 1]);

function rectModelBuffer(
  gl: WebGL2RenderingContext,
  shader: Shader,
): WebGLBuffer {
  let buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);

  const location = gl.getAttribLocation(shader.program, "_LOCAL_POS");
  gl.enableVertexAttribArray(location);
  gl.vertexAttribPointer(location, 2, gl.FLOAT, false, 0, 0);

  return buf;
}

const defaultProperties = new Set([
  "TRANSFORM",
  "SCREEN_POS",
  "WORLD_POS",
  "LOCAL_POS",
]);

function vertSource(shader: Shader): string {
  let attributes = "";
  let varyings = "";
  let interpolations = "";

  // serialize attributes, varyings, and interpolations
  for (const p of shader.properties) {
    if (defaultProperties.has(p.name)) continue;

    attributes += `in ${p.type} _${p.name};\n`;
    varyings += `out ${p.type} ${p.name};\n`;
    interpolations += `${p.name} = _${p.name};\n`;
  }

  const screen_pos_calc =
    shader.mode === "fullscreen"
      ? "_LOCAL_POS"
      : "(WORLD_TO_SCREEN * world).xy";

  const world_pos_calc =
    shader.mode === "fullscreen"
      ? "SCREEN_TO_WORLD * vec3(_LOCAL_POS, 1.0)"
      : "TRANSFORM * vec3(_LOCAL_POS, 1.0)";

  return `#version 300 es
  uniform mat3 WORLD_TO_SCREEN;
  uniform mat3 SCREEN_TO_WORLD;

  in vec2 _LOCAL_POS; // per-vertex
  in mat3 TRANSFORM;  // per-instance
  ${attributes}

  out vec2 SCREEN_POS;
  out vec2 WORLD_POS;
  out vec2 LOCAL_POS;
  ${varyings}

  void main() {
    vec3 world = ${world_pos_calc};

    SCREEN_POS = ${screen_pos_calc}.xy;
    WORLD_POS = world.xy;
    LOCAL_POS = _LOCAL_POS;

    gl_Position = vec4((SCREEN_POS - 0.5) * 2.0, 0.0, 1.0);

    ${interpolations}
  }
`;
}

init();
