import { mat2d, mat3, vec2 } from "gl-matrix";
import { Schedule, State, Transform, View } from "./zen";
import { Attribute, Entity } from "./state";

import presentSrc from "./present.frag?raw";

const shaders: ShaderData[] = [];
const renderPasses: RenderPassData[] = [];
let presentPass: RenderPass;

const renderTextures: Map<string, RenderTexture> = new Map();
const depthStencilBuffer: RenderBuffer = createDepthStencilBuffer();

const OpaqueShader = Symbol(); // opaque type tag
export type Shader = number & { [OpaqueShader]: never };

const OpaqueRenderPass = Symbol(); // opaque type tag
export type RenderPass = number & { [OpaqueRenderPass]: never };

const OpaqueTexture = Symbol(); // opaque type tag
export type Texture = number & { [OpaqueTexture]: never };

function init() {
  createRenderTexture("COLOR", 1, true);

  const present = createShader(presentSrc, "fullscreen", { inputs: ["COLOR"] });
  presentPass = createRenderPass(present, { drawOrder: 100000 });

  const renderSignal = Schedule.signalAfter(Schedule.update);
  Schedule.onSignal(renderSignal, {
    query: { include: [Renderer] },
    foreach: enqueueInstance,
    once: render,
  });
}

export function createRenderPass(
  shader: Shader,
  options: {
    drawOrder?: number;
    // scale?: number; //TODO support render pass scaling
    depthTest?: DepthTest | "none";
    depthWrite?: boolean;
    blend?: BlendFunction;
  } = {},
): RenderPass {
  const gl = View.gl();

  const shaderData = shaders[shader];

  const vao = gl.createVertexArray();
  gl.bindVertexArray(vao);
  const modelBuffer = createModelBuffer();
  const instanceBuffer = createInstanceBuffer(shaderData);
  gl.bindVertexArray(null);

  // const scale = Math.max(0.01, options.scale || 1);
  const scale = 1;

  const inputs: RenderTexture[] = [];
  for (const i of shaderData.inputs) {
    inputs.push(createRenderTexture(i.name, scale, true));
  }

  const outputs: RenderTexture[] = [];
  for (const o of shaderData.outputs) {
    outputs.push(createRenderTexture(o.name, scale, true));
  }

  const depthOpt = options.depthTest || "less-equal";
  const depthTest = depthOpt === "none" ? null : glDepthTest(depthOpt);
  const depthWrite =
    options.depthWrite !== undefined ? options.depthWrite : true;

  const blend = options.blend
    ? { src: glBlend(options.blend.src), dest: glBlend(options.blend.dest) }
    : null;

  const pass: RenderPassData = {
    id: renderPasses.length as RenderPass,
    shader: shaderData,
    depthTest,
    depthWrite,
    blend,
    vao,
    modelBuffer,
    instanceBuffer,
    framebuffer: gl.createFramebuffer(),
    drawOrder: options.drawOrder || 0,
    scale,
    uniformValues: {},
    samplerSettings: {},
    textureArrays: {},
    inputs,
    outputs,
    propertyValues: [],
    instanceCount: 0,
  };

  // sort render passes by drawOrder, ascending
  insertSorted(renderPasses, pass, (a, b) => a.drawOrder - b.drawOrder);

  return pass.id;
}

export type DepthTest =
  | "less"
  | "less-equal"
  | "greater"
  | "greater-equal"
  | "equal"
  | "not-equal";

export type Blend =
  | "zero"
  | "one"
  | "src-color"
  | "dest-color"
  | "src-alpha"
  | "dest-alpha"
  | "one-minus-src-alpha"
  | "one-minus-dest-alpha"
  | "one-minus-src-color"
  | "one-minus-dest-color";

/** Result = (Source Color * src) + (Destination Color * dest) */
export interface BlendFunction {
  src: Blend;
  dest: Blend;
}

function glDepthTest(test: DepthTest): GLenum {
  const gl = View.gl();

  switch (test) {
    case "less":
      return gl.LESS;
    case "less-equal":
      return gl.LEQUAL;
    case "greater":
      return gl.GREATER;
    case "greater-equal":
      return gl.GEQUAL;
    case "equal":
      return gl.EQUAL;
    case "not-equal":
      return gl.NOTEQUAL;
    default:
      throw new Error(`unsupported depth test '${test}'`);
  }
}

function glBlend(blend: Blend): GLenum {
  const gl = View.gl();

  switch (blend) {
    case "zero":
      return gl.ZERO;
    case "one":
      return gl.ONE;
    case "src-color":
      return gl.SRC_COLOR;
    case "dest-color":
      return gl.DST_COLOR;
    case "src-alpha":
      return gl.SRC_ALPHA;
    case "dest-alpha":
      return gl.DST_ALPHA;
    case "one-minus-src-alpha":
      return gl.ONE_MINUS_SRC_ALPHA;
    case "one-minus-dest-alpha":
      return gl.ONE_MINUS_DST_ALPHA;
    case "one-minus-src-color":
      return gl.ONE_MINUS_SRC_COLOR;
    case "one-minus-dest-color":
      return gl.ONE_MINUS_DST_COLOR;
    default:
      throw new Error(`unsupported blend factor '${blend}'`);
  }
}

interface RenderPassData {
  id: RenderPass;
  shader: ShaderData;
  depthTest: GLenum | null;
  depthWrite: boolean;
  blend: { src: GLenum; dest: GLenum } | null;
  vao: WebGLVertexArrayObject;
  modelBuffer: WebGLBuffer;
  instanceBuffer: WebGLBuffer;
  drawOrder: number;
  uniformValues: Record<string, UniformValue>;
  samplerSettings: Record<string, SamplerSettings>;
  scale: number;
  framebuffer: WebGLFramebuffer;
  textureArrays: Record<string, TextureData>;
  inputs: RenderTexture[];
  outputs: RenderTexture[];

  // per-execution state
  instanceCount: number;
  propertyValues: number[];
}

export function setUniform(pass: RenderPass, name: string, value: GLValue) {
  const passData = getRenderPassData(pass);

  const u = passData.shader.uniforms.find((u) => u.name === name);
  if (!u) {
    console.log(`WARNING: undefined uniform '${name}'`);
    return;
  }

  passData.uniformValues[name] = { uniform: u, value };
}

export function setTexture(pass: RenderPass, name: string, value: TextureData) {
  const passData = getRenderPassData(pass);

  const u = passData.shader.uniforms.find((u) => u.name === name);
  if (!u || u.type !== "sampler2DArray") {
    console.log(`WARNING: texture '${name}' missing sampler`);
  }

  passData.textureArrays[name] = value;
}

function getRenderPassData(id: RenderPass): RenderPassData {
  return renderPasses.find((p) => p.id === id)!;
}

// export function createTexture() {}

function clearRenderPass(p: RenderPassData) {
  const gl = View.gl();

  gl.bindFramebuffer(gl.FRAMEBUFFER, p.framebuffer);
  gl.clear(gl.COLOR_BUFFER_BIT);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
}

function executeRenderPass(p: RenderPassData) {
  const gl = View.gl();

  // bind objects (program, vao, framebuffer)
  gl.useProgram(p.shader.program);
  gl.bindVertexArray(p.vao);
  gl.bindFramebuffer(gl.FRAMEBUFFER, p.framebuffer);

  //TODO
  const drawBuffers: GLenum[] = [];

  // bind depth stencil buffer
  updateDepthStencilBufferSize();
  gl.framebufferRenderbuffer(
    gl.FRAMEBUFFER,
    gl.DEPTH_STENCIL_ATTACHMENT,
    gl.RENDERBUFFER,
    depthStencilBuffer.buffer,
  );

  // bind render texture outputs
  let attachment = gl.COLOR_ATTACHMENT0;
  for (const rt of p.outputs) {
    rt.updateSize();
    rt.texture;
    gl.framebufferTexture2D(
      gl.FRAMEBUFFER,
      attachment,
      gl.TEXTURE_2D,
      rt.texture,
      0,
    );

    drawBuffers.push(attachment);
    attachment++;
  }

  gl.drawBuffers(drawBuffers);

  // bind render texture inputs
  let texUnit = 0;
  for (const rt of p.inputs) {
    const name = `IN_${rt.name}`;
    const tex = rt.isSwappable() ? rt.altTexture : rt.texture;
    gl.activeTexture(gl.TEXTURE0 + texUnit);
    gl.bindTexture(gl.TEXTURE_2D, tex);
    setUniform(p.id, name, { type: "int", value: texUnit });
    texUnit++;
  }

  for (const [name, tex] of Object.entries(p.textureArrays)) {
    //TODO bind textures to texture units
    //TODO update sampler uniform values
    //TODO upload sampler parameters
  }

  // update builtin uniform values
  const vpTRS = View.transform().trs();
  const vpTRSI = mat2d.create();
  mat2d.invert(vpTRSI, vpTRS);

  setUniform(p.id, "SCREEN_TO_WORLD", {
    type: "mat3",
    value: mat3.fromMat2d(mat3.create(), vpTRS),
  });

  setUniform(p.id, "WORLD_TO_SCREEN", {
    type: "mat3",
    value: mat3.fromMat2d(mat3.create(), vpTRSI),
  });

  // upload uniform values
  for (const u of Object.values(p.uniformValues)) {
    uploadUniformValue(u);
  }

  // upload instance buffer data
  gl.bindBuffer(gl.ARRAY_BUFFER, p.instanceBuffer);
  gl.bufferData(
    gl.ARRAY_BUFFER,
    new Float32Array(p.propertyValues),
    gl.STATIC_DRAW,
  );
  gl.bindBuffer(gl.ARRAY_BUFFER, null);

  // do not use framebuffer if this is the present pass
  if (p.id === presentPass) {
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }

  if (p.depthTest) {
    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(p.depthTest);
  } else {
    gl.disable(gl.DEPTH_TEST);
  }

  if (p.blend) {
    gl.enable(gl.BLEND);
    gl.blendFunc(p.blend.src, p.blend.dest);
  } else {
    gl.disable(gl.BLEND);
  }

  gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, p.instanceCount);

  // swap render textures
  for (const rt of p.outputs) rt.swap();

  // unbind objects
  gl.useProgram(null);
  gl.bindVertexArray(null);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);

  // clear per-pass state
  p.instanceCount = 0;
  p.propertyValues = [];
}

function uploadUniformValue(u: UniformValue) {
  //! assumes gl program is bound

  const gl = View.gl();
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
    case "int":
      gl.uniform1i(u.uniform.location, u.value.value);
  }
}

function insertSorted<T>(
  arr: T[],
  item: T,
  compareFn: (a: T, b: T) => number,
): T[] {
  const index = arr.findIndex((e) => compareFn(item, e) <= 0);
  arr.splice(index, 0, item);
  return arr;
}

function enqueueInstance(e: Entity) {
  const r = State.getAttribute<Renderer>(e, Renderer)!;
  const pass = getRenderPassData(r.pass);

  // required for all non-fullscreen shaders
  const t = State.getAttribute<Transform>(e, Transform);
  if (pass.shader.mode === "world" && !t) {
    console.log("ERROR: world shaders require a Transform attribute");
    return;
  }

  // _TRANSFORM built-in property
  if (t) pass.propertyValues.push(...mat3.fromMat2d(mat3.create(), t.trs()));

  // _DEPTH built-in property
  pass.propertyValues.push(r.depth);

  // add value to property data buffer
  for (const p of r.properties) {
    if (p.type === "float" || p.type === "int") {
      pass.propertyValues.push(p.value);
    } else {
      pass.propertyValues.push(...p.value);
    }
  }

  pass.instanceCount++;
}

function render() {
  const gl = View.gl();
  View.updateScale();

  gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT | gl.STENCIL_BUFFER_BIT);

  for (const pass of renderPasses) {
    if (pass.id === presentPass) pass.instanceCount = 1;
    executeRenderPass(pass);
  }

  // clear after execute, guarantees framebuffers are set up
  for (const pass of renderPasses) clearRenderPass(pass);
}

function createRenderTexture(
  name: string,
  resolution: number,
  swappable: boolean,
): RenderTexture {
  const rt = renderTextures.get(name);

  if (!rt) {
    const newRt = new RenderTexture(name, resolution, swappable);
    renderTextures.set(name, newRt);
    return newRt;
  }

  if (rt.resolution === resolution) {
    if (swappable) rt.makeSwappable();
    return rt;
  }

  throw new Error(`RenderTexture name collision '${name}'`);
}

interface RenderBuffer {
  buffer: WebGLRenderbuffer;
  size: vec2;
}

function createDepthStencilBuffer(): RenderBuffer {
  const size = scaleTextureSize(View.renderSize(), 1);
  return { buffer: createRenderBuffer(size), size };
}

function updateDepthStencilBufferSize() {
  const newSize = scaleTextureSize(View.renderSize(), 1);
  const size = depthStencilBuffer.size;

  const needResize = size[0] != newSize[0] || size[1] != newSize[1];
  if (!needResize) return;

  View.gl().deleteRenderbuffer(depthStencilBuffer.buffer);
  depthStencilBuffer.buffer = createRenderBuffer(newSize);
  depthStencilBuffer.size = newSize;
}

function createRenderBuffer(size: vec2): WebGLRenderbuffer {
  const gl = View.gl();
  const buf = gl.createRenderbuffer();

  gl.bindRenderbuffer(gl.RENDERBUFFER, buf);
  gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_STENCIL, size[0], size[1]);
  gl.bindRenderbuffer(gl.RENDERBUFFER, null);

  return buf;
}

function createTexture(size: vec2): WebGLTexture {
  const gl = View.gl();
  const tex = gl.createTexture();

  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGBA8, size[0], size[1]);
  gl.bindTexture(gl.TEXTURE_2D, null);

  return tex;
}

type ShaderMode = "world" | "fullscreen";

export function createShader(
  source: string,
  mode: ShaderMode,
  options: {
    uniforms?: Record<string, GLType | GLSamplerType>;
    properties?: Record<string, GLType>;
    inputs?: string[];
    outputs?: string[];
  } = {},
): Shader {
  const gl = View.gl();

  const uniforms: Uniform[] = [];
  const properties: Property[] = [];
  const inputs: Input[] = [];
  const outputs: Output[] = [];

  // add uniforms
  uniforms.push({ name: "WORLD_TO_SCREEN", type: "mat3", location: 0 });
  uniforms.push({ name: "SCREEN_TO_WORLD", type: "mat3", location: 0 });
  //TODO TIME, DELTA_TIME, SCREEN_COLOR
  for (const [name, type] of Object.entries(options.uniforms || {})) {
    uniforms.push({ name, type, location: 0 });
  }

  // add properties
  if (mode === "world") {
    properties.push({ name: "_TRANSFORM", type: "mat3", location: 0 });
  }
  properties.push({ name: "_DEPTH", type: "float", location: 0 });

  for (const [name, type] of Object.entries(options.properties || {})) {
    properties.push({ name, type, location: 0 });
  }

  // add inputs
  for (const i of options.inputs || []) {
    inputs.push({ name: i, location: 0 });
    uniforms.push({ name: `IN_${i}`, type: "int", location: 0 });
  }

  // add outputs
  outputs.push({ name: "COLOR", location: 0 });
  for (const o of options.outputs || []) {
    outputs.push({ name: o, location: 0 });
  }

  const vertSrc = generateVertexShader(mode, properties);
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
  for (const u of uniforms) {
    u.location = gl.getUniformLocation(program, u.name)!;
  }

  // get property locations
  for (const p of properties) {
    p.location = gl.getAttribLocation(program, p.name);
  }

  // get output locations
  for (const o of outputs) {
    o.location = gl.getFragDataLocation(program, o.name);
  }

  const shader: ShaderData = {
    id: shaders.length as Shader,
    program,
    mode,
    uniforms,
    properties,
    inputs,
    outputs,
  };

  shaders.push(shader);
  return shader.id;
}

export interface ShaderData {
  id: Shader;
  program: WebGLProgram;
  mode: ShaderMode;
  uniforms: Uniform[];
  properties: Property[];
  inputs: Input[];
  outputs: Output[];
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

type GLType = "float" | "vec2" | "mat3" | "int";
type GLValue = FloatValue | Vec2Value | Mat3Value | IntValue;
type GLSamplerType = "sampler2D" | "sampler2DArray";

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

interface IntValue {
  type: "int";
  value: number;
}

interface Property {
  name: string;
  type: GLType;
  location: number;
}

interface Input {
  name: string;
  location: WebGLUniformLocation;
}

interface Output {
  name: string;
  location: number;
}

interface Uniform {
  name: string;
  type: GLType | GLSamplerType;
  location: WebGLUniformLocation;
}

type TextureSource = HTMLImageElement | Uint8ClampedArray;

class TextureData {
  // id: Texture;
  size: TextureSize;
  layers: number;
  unit: number | null = null;
  // TODO mipmap settings

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

function scaleTextureSize(size: vec2, scale: number): vec2 {
  const s = vec2.scale([0, 0], size, scale);
  s[0] = Math.ceil(s[0]);
  s[1] = Math.ceil(s[1]);

  // make sure is at least 1x1
  s[0] = Math.max(1, s[0]);
  s[1] = Math.max(1, s[1]);

  return s;
}

class RenderTexture {
  name: string;
  resolution: number;
  texture: WebGLTexture;
  altTexture: WebGLTexture | null;

  private size: vec2 = [1, 1];

  constructor(name: string, resolution: number, swappable: boolean) {
    const res = Math.max(0.01, resolution);
    const texSize = scaleTextureSize(View.renderSize(), res);

    this.name = name;
    this.resolution = res;
    this.size = texSize;
    this.texture = createTexture(texSize);
    this.altTexture = swappable ? createTexture(texSize) : null;
  }

  updateSize() {
    const newSize = scaleTextureSize(View.renderSize(), this.resolution);
    const size = this.size;

    const needResize = newSize[0] !== size[0] || newSize[1] !== size[1];
    if (!needResize) return;

    const gl = View.gl();

    gl.deleteTexture(this.texture);
    this.texture = createTexture(newSize);
    this.size = newSize;

    if (this.altTexture) {
      gl.deleteTexture(this.altTexture);
      this.altTexture = createTexture(newSize);
    }
  }

  makeSwappable() {
    if (this.altTexture) return;
    this.altTexture = createTexture(this.size);
  }

  isSwappable(): boolean {
    return this.altTexture !== null;
  }

  swap() {
    if (!this.isSwappable()) return;

    const gl = View.gl();
    const size = this.size;

    // copy data from texture to altTexture
    gl.bindTexture(gl.TEXTURE_2D, this.altTexture);
    gl.copyTexSubImage2D(gl.TEXTURE_2D, 0, 0, 0, 0, 0, size[0], size[1]);
    gl.bindTexture(gl.TEXTURE_2D, null);

    const tex = this.texture;
    this.texture = this.altTexture!;
    this.altTexture = tex;
  }
}

function getPropertySize(p: Property): number {
  switch (p.type) {
    case "float":
      return 1;
    case "vec2":
      return 2;
    case "mat3":
      return 9;
    case "int":
      return 1;
  }
}

export class Renderer extends Attribute {
  pass: RenderPass;
  depth: number; // [0.0, 1.0] range
  properties: GLValue[] = [];

  private passData: RenderPassData;

  constructor(pass: RenderPass, options: { depth?: number } = {}) {
    super();
    this.pass = pass;
    this.passData = getRenderPassData(pass);
    this.depth = options.depth !== undefined ? options.depth : 1;
  }

  setProperty(name: string, value: GLValue): Renderer {
    const idx = this.passData.shader.properties.findIndex(
      (p) => p.name === name,
    );
    if (idx < 0) {
      console.log(`WARNING: undefined property '${name}'`);
      return this;
    }

    this.properties[idx] = value;
    return this;
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
  mipmapMode: FilterMode | "none";
}

function createInstanceBuffer(shader: ShaderData): WebGLBuffer {
  const gl = View.gl();

  const buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);

  // number of f32s per instance
  let stride = 0;

  // set up attributes
  for (const p of shader.properties) {
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

  gl.bindBuffer(gl.ARRAY_BUFFER, null);
  return buf;
}

function createModelBuffer(): WebGLBuffer {
  const gl = View.gl();
  const verts = new Float32Array([0, 0, 1, 0, 1, 1, 0, 0, 0, 1, 1, 1]);

  const buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);

  // _LOCAL_POS
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
  gl.bufferData(gl.ARRAY_BUFFER, verts, gl.STATIC_DRAW);

  gl.bindBuffer(gl.ARRAY_BUFFER, null);
  return buf;
}

const defaultProperties = new Set([
  "_TRANSFORM",
  "_DEPTH",
  "DEPTH",
  "SCREEN_POS",
  "WORLD_POS",
  "LOCAL_POS",
]);

function generateVertexShader(
  mode: ShaderMode,
  properties: Property[],
): string {
  let attributes = "";
  let varyings = "";
  let interpolations = "";

  // serialize attributes, varyings, and interpolations
  for (const p of properties) {
    if (defaultProperties.has(p.name)) continue;

    attributes += `in ${p.type} _${p.name};\n`;
    varyings += `out ${p.type} ${p.name};\n`;
    interpolations += `${p.name} = _${p.name};\n`;
  }

  const screen_pos_calc =
    mode === "fullscreen" ? "_LOCAL_POS" : "(WORLD_TO_SCREEN * world)";

  const world_pos_calc =
    mode === "fullscreen"
      ? "SCREEN_TO_WORLD * vec3(_LOCAL_POS, 1.0)"
      : "_TRANSFORM * vec3(_LOCAL_POS, 1.0)";

  return `#version 300 es
  uniform mat3 WORLD_TO_SCREEN;
  uniform mat3 SCREEN_TO_WORLD;

  layout(location = 0) in vec2 _LOCAL_POS; // per-vertex
  ${mode === "world" ? "in mat3 _TRANSFORM; // per-instance" : ""}
  in float _DEPTH; // per-instance
  ${attributes}

  out float DEPTH;
  out vec2 SCREEN_POS;
  out vec2 WORLD_POS;
  out vec2 LOCAL_POS;
  ${varyings}

  void main() {
    vec3 world = ${world_pos_calc};

    DEPTH = min(0.0, max(1.0, _DEPTH));
    SCREEN_POS = ${screen_pos_calc}.xy;
    WORLD_POS = world.xy;
    LOCAL_POS = _LOCAL_POS;

    gl_Position = vec4((SCREEN_POS - 0.5) * 2.0, DEPTH, 1.0);

    ${interpolations}
  }
`;
}

init();
