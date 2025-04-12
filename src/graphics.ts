import { mat2d, mat3, vec2 } from "gl-matrix";
import { Schedule, State, Transform, View } from "./zen";
import { Attribute, Entity } from "./state";

const renderTextures: Map<string, RenderTexture> = new Map();
let depthStencilBuffer: WebGLRenderbuffer = createRenderBuffer();

const renderPasses: RenderPass[] = [];

function init() {
  renderTextures.set("COLOR", new RenderTexture(View.gl(), "rgba8", 1, true));

  const renderSignal = Schedule.signalAfter(Schedule.update);
  Schedule.onSignal(renderSignal, {
    query: { include: [Renderer] },
    foreach: enqueueDraw,
    once: draw,
  });
}

export function createShader(source: string, mode: ShaderMode): Shader {
  const shader = new Shader(source, mode);
  return shader;
}

export function createRenderPass(
  shader: Shader,
  options: { drawOrder?: number } = {},
): RenderPass {
  const pass = new RenderPass(shader);
  pass.drawOrder = options.drawOrder || 0;

  // sort render passes by drawOrder, ascending
  insertSorted(renderPasses, pass, (a, b) => a.drawOrder - b.drawOrder);

  return pass;
}

function insertSorted<T>(
  arr: T[],
  item: T,
  compareFn: (a: T, b: T) => number,
): T[] {
  const index = arr.findIndex((e) => compareFn(item, e));
  arr.splice(index, 0, item);
  return arr;
}

function enqueueDraw(e: Entity) {
  const d = State.getAttribute<Renderer>(e, Renderer)!;

  // TRANSFORM built-in property
  // required for all non-fullscreen shaders
  const t = State.getAttribute<Transform>(e, Transform);
  if (d.pass.shader.mode === "world" && !t) {
    console.log("ERROR: world shaders require a Transform attribute");
    return;
  }

  if (t) d.pass.propertyValues.push(...mat3.fromMat2d(mat3.create(), t.trs()));

  // add value to property data buffer
  for (const p of d.properties) {
    if (p.type === "float") d.pass.propertyValues.push(p.value);
    else d.pass.propertyValues.push(...p.value);
  }

  d.pass.instanceCount++;
}

function draw() {
  const gl = View.gl();
  View.updateScale();

  gl.clear(gl.COLOR_BUFFER_BIT);

  // prepare and dispatch an instanced draw call for each render pass
  // TODO replace with renderPass.draw()
  for (let i = 0; i < renderPasses.length; i++) {
    const pass = renderPasses[i];

    gl.useProgram(pass.shader.program);
    gl.bindVertexArray(pass.vao);

    const vpTRS = View.transform().trs();
    const vpTRSI = mat2d.create();
    mat2d.invert(vpTRSI, vpTRS);

    pass.setMatrixUniform(
      "SCREEN_TO_WORLD",
      mat3.fromMat2d(mat3.create(), vpTRS),
    );

    pass.setMatrixUniform(
      "WORLD_TO_SCREEN",
      mat3.fromMat2d(mat3.create(), vpTRSI),
    );

    // update uniform values
    for (const u of Object.values(pass.uniformValues)) {
      switch (u.value.type) {
        case "float":
          gl.uniform1f(u.uniform.location, u.value.value);
          break;
        case "vec2":
          gl.uniform2fv(u.uniform.location, u.value.value);
          break;
        case "mat3":
          gl.uniformMatrix3fv(u.uniform.location, false, u.value.value);
          break;
      }
    }

    gl.bindBuffer(gl.ARRAY_BUFFER, pass.modelBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, rectVerts, gl.STATIC_DRAW);

    gl.bindBuffer(gl.ARRAY_BUFFER, pass.instanceBuffer.buffer);
    gl.bufferData(
      gl.ARRAY_BUFFER,
      new Float32Array(pass.propertyValues),
      gl.STATIC_DRAW,
    );

    gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, pass.instanceCount);

    gl.bindVertexArray(null);
    gl.useProgram(null);

    pass.instanceCount = 0;
    pass.propertyValues = [];
  }
}

function createRenderTexture(
  name: string,
  format: TextureFormat,
  resolution: number,
  swappable: boolean,
): RenderTexture {
  const rt = renderTextures.get(name);

  if (
    rt &&
    rt.format === format &&
    rt.resolution === resolution &&
    rt.isSwappable() === swappable
  ) {
    return rt;
  }

  const newRt = new RenderTexture(View.gl(), format, resolution, swappable);
  renderTextures.set(name, newRt);
  return newRt;
}

function createRenderBuffer(): WebGLRenderbuffer {
  const gl = View.gl();
  const size = View.renderSize();
  const buf = gl.createRenderbuffer();

  gl.bindRenderbuffer(gl.RENDERBUFFER, buf);
  gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_STENCIL, size[0], size[1]);
  gl.bindRenderbuffer(gl.RENDERBUFFER, null);

  return buf;
}

function createTexture(size: vec2, format: TextureFormat): WebGLTexture {
  const gl = View.gl();

  let glFormat;
  switch (format) {
    case "rgba8": {
      glFormat = gl.RGBA8;
      break;
    }
    default: {
      throw new Error(`unsupported texture format '${format}'`);
    }
  }

  const tex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texStorage2D(gl.TEXTURE_2D, 1, glFormat, size[0], size[1]);
  gl.bindTexture(gl.TEXTURE_2D, null);

  return tex;
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
    const gl = View.gl();
    this.mode = mode;

    // add uniforms
    this.uniforms.push({ name: "WORLD_TO_SCREEN", type: "mat3", location: 0 });
    this.uniforms.push({ name: "SCREEN_TO_WORLD", type: "mat3", location: 0 });
    //TODO TIME, DELTA_TIME, SCREEN_COLOR
    for (const [name, type] of Object.entries(options?.uniforms || {})) {
      this.uniforms.push({ name, type, location: 0 });
    }

    // add properties
    if (this.mode === "world") {
      this.properties.push({ name: "TRANSFORM", type: "mat3", location: 0 });
    }

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
    const gl = View.gl();

    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, tex);
    //TODO upload texture array data from source (treat as atlas)
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, null);

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
    const texSize = vec2.scale(vec2.create(), View.renderSize(), resolution);

    this.format = format;
    this.resolution = resolution;
    this.texture = createTexture(texSize, format);
    this.altTexture = swappable ? createTexture(texSize, format) : null;
  }

  isSwappable(): boolean {
    return this.altTexture !== null;
  }

  //TODO get write/read references, handle swapping
  // getWriteable(): WebGLTexture {
  //   return this.texture;
  // }

  // getReadable(): WebGLTexture {
  //   return this.altTexture;
  // }

  //TODO
  // get(x, y): vec4
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

export class Renderer extends Attribute {
  pass: RenderPass;
  properties: GLValue[] = [];

  constructor(group: RenderPass) {
    super();
    this.pass = group;
  }

  setNumberProperty(name: string, value: number): Renderer {
    return this.setProperty(name, { type: "float", value });
  }

  setVectorProperty(name: string, value: vec2): Renderer {
    return this.setProperty(name, { type: "vec2", value });
  }

  setMatrixProperty(name: string, value: mat3): Renderer {
    return this.setProperty(name, { type: "mat3", value });
  }

  private setProperty(name: string, value: GLValue): Renderer {
    const idx = this.pass.shader.properties.findIndex((p) => p.name === name);
    if (idx < 0) {
      console.log(`WARNING: undefined property '${name}'`);
      return this;
    }

    this.properties[idx] = value;
    return this;
  }
}

export class RenderPass {
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
  private inputs: RenderTexture[] = [];
  private outputs: RenderTexture[] = [];

  constructor(shader: Shader) {
    const gl = View.gl();

    const vao = gl.createVertexArray();
    gl.bindVertexArray(vao);
    const modelBuffer = rectModelBuffer(gl, shader);
    const instanceBuffer = new BufferFormat(gl, shader);
    gl.bindVertexArray(null);

    //TODO set inputs and outputs from shader
    for (const o of shader.outputs) {
      //TODO support more output formats
      //TODO
      createRenderTexture(o.name, "rgba8", 1, true);
    }

    const fb = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fb);

    //TODO attach render textures
    for (const o of this.outputs) {
    }

    gl.framebufferRenderbuffer(
      gl.FRAMEBUFFER,
      gl.DEPTH_STENCIL_ATTACHMENT,
      gl.RENDERBUFFER,
      depthStencilBuffer,
    );

    gl.bindFramebuffer(gl.FRAMEBUFFER, null);

    this.gl = gl;
    this.shader = shader;
    this.vao = vao;
    this.modelBuffer = modelBuffer;
    this.instanceBuffer = instanceBuffer;
    this.framebuffer = fb;
  }

  setNumberUniform(name: string, value: number): RenderPass {
    this.setUniform(name, { type: "float", value });
    return this;
  }

  setVectorUniform(name: string, value: vec2): RenderPass {
    this.setUniform(name, { type: "vec2", value });
    return this;
  }

  setMatrixUniform(name: string, value: mat3): RenderPass {
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

  setTexture(name: string, value: TextureArray): RenderPass {
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
    shader.mode === "fullscreen" ? "_LOCAL_POS" : "(WORLD_TO_SCREEN * world)";

  const world_pos_calc =
    shader.mode === "fullscreen"
      ? "SCREEN_TO_WORLD * vec3(_LOCAL_POS, 1.0)"
      : "TRANSFORM * vec3(_LOCAL_POS, 1.0)";

  return `#version 300 es
  uniform mat3 WORLD_TO_SCREEN;
  uniform mat3 SCREEN_TO_WORLD;

  in vec2 _LOCAL_POS; // per-vertex
  ${shader.mode === "world" ? "in mat3 TRANSFORM; // per-instance" : ""}
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
