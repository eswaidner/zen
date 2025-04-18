import { mat2d, mat3, vec2, vec4 } from "gl-matrix";
import { Schedule, State, Transform, View } from "./zen";
import { Attribute, Entity } from "./state";

//@ts-expect-error shader file not auto-detected
import presentSrc from "./present.frag?raw";

const gl = View.gl();
const framebuffer: Framebuffer = createFramebuffer();
const verts = new Float32Array([0, 0, 1, 0, 1, 1, 0, 0, 0, 1, 1, 1]);
const modelBuffer: WebGLBuffer = gl.createBuffer();
const shaders: ShaderData[] = [];
const renderPasses: RenderPassData[] = [];
const textures: TextureData[] = [];
let presentPass: RenderPass;

const OpaqueShader = Symbol(); // opaque type tag
export type Shader = number & { [OpaqueShader]: never };

const OpaqueRenderPass = Symbol(); // opaque type tag
export type RenderPass = number & { [OpaqueRenderPass]: never };

const OpaqueTexture = Symbol(); // opaque type tag
export type Texture = number & { [OpaqueTexture]: never };

function init() {
  createRenderTexture("COLOR");

  const present = createShader(presentSrc, "fullscreen", { inputs: ["COLOR"] });
  presentPass = createRenderPass(present, {
    drawOrder: Infinity,
    inputs: { COLOR: "COLOR" },
    outputs: { COLOR: "COLOR" },
  });

  const renderSignal = Schedule.signalAfter(Schedule.update);
  Schedule.onSignal(renderSignal, {
    query: { include: [Renderer] },
    foreach: enqueueInstance,
    once: render,
  });
}

export function setRenderPassActive(pass: RenderPass, enable: boolean) {
  getRenderPassData(pass).enabled = enable;
}

export function setBackgroundColor(color: vec4) {
  View.gl().clearColor(color[0], color[1], color[2], color[3]);
}

export function createTexture(size: TextureSize, layers: number): Texture {
  const validLayers = Math.floor(Math.max(1, layers));
  const tex = new TextureData(size, validLayers);
  return tex.id;
}

export function createRenderPass(
  shader: Shader,
  options: {
    drawOrder?: number;
    depthTest?: DepthTest | "none";
    depthWrite?: boolean;
    blend?: BlendFunction;
    inputs?: Record<string, string>; // shader input name : render texture name
    outputs?: Record<string, string>; // shader output name : render texture name
  } = {},
): RenderPass {
  const shaderData = shaders[shader];

  const vao = gl.createVertexArray();
  gl.bindVertexArray(vao);
  attachModelBuffer(modelBuffer);
  const instanceBuffer = createInstanceBuffer(shaderData);
  gl.bindVertexArray(null);

  const inputs: number[] = [];
  for (const [inputName, rtName] of Object.entries(options.inputs || {})) {
    if (!shaderData.inputs.find((i) => i.name === inputName)) {
      throw new Error(`undefined shader input '${inputName}'`);
    }

    inputs.push(createRenderTexture(rtName));
  }

  const outputs: number[] = [];
  for (const [outName, rtName] of Object.entries(options.outputs || {})) {
    if (!shaderData.outputs.find((i) => i.name === outName)) {
      throw new Error(`undefined shader output '${outName}'`);
    }

    outputs.push(createRenderTexture(rtName));
  }

  const outputDelta = shaderData.outputs.length - outputs.length;
  if (outputDelta !== 0) {
    throw new Error(`render pass missing ${outputDelta} outputs from shader`);
  }

  const depthOpt = options.depthTest || "less-equal";
  const depthTest = depthOpt === "none" ? null : glDepthTest(depthOpt);
  const depthWrite =
    options.depthWrite !== undefined ? options.depthWrite : true;

  const blend = options.blend
    ? { src: glBlend(options.blend.src), dest: glBlend(options.blend.dest) }
    : null;

  // activate render pass outputs
  const activeAttachments: GLenum[] = [];
  let activeIdx = 0;
  for (let i = 0; i < 8; i++) {
    const activate = outputs[activeIdx] === i;
    activeAttachments.push(activate ? gl.COLOR_ATTACHMENT0 + i : gl.NONE);
    if (activate) activeIdx++;
  }

  const pass: RenderPassData = {
    id: renderPasses.length as RenderPass,
    enabled: true,
    shader: shaderData,
    depthTest,
    depthWrite,
    blend,
    vao,
    instanceBuffer,
    drawOrder: options.drawOrder || 0,
    uniformValues: {},
    samplerSettings: {},
    inputs,
    outputs,
    activeAttachments,
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
  enabled: boolean;
  shader: ShaderData;
  depthTest: GLenum | null;
  depthWrite: boolean;
  blend: { src: GLenum; dest: GLenum } | null;
  vao: WebGLVertexArrayObject;
  instanceBuffer: WebGLBuffer;
  drawOrder: number;
  uniformValues: Record<string, UniformValue>;
  samplerSettings: Record<string, SamplerSettings>;
  inputs: number[]; // render texture idx
  outputs: number[]; // render texture idx
  activeAttachments: GLenum[]; // gl.drawBuffers list

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

export function addTextureLayer(texture: Texture, src: TexImageSource): number {
  const texData = textures[texture];
  return texData.addLayer(src);
}

export function setTextureLayer(
  texture: Texture,
  index: number,
  src: TexImageSource,
) {
  const texData = textures[texture];
  texData.setLayer(index, src);
}

function getRenderPassData(id: RenderPass): RenderPassData {
  return renderPasses.find((p) => p.id === id)!;
}

function executeRenderPass(p: RenderPassData) {
  // bind objects (program, vao, framebuffer)
  //! assumes framebuffer is already bound
  gl.useProgram(p.shader.program);
  gl.bindVertexArray(p.vao);

  // activate framebuffer attachments
  gl.drawBuffers(p.activeAttachments);

  // should never exceed 15
  let texUnit = 0;

  // bind render texture inputs
  for (const rtIdx of p.inputs) {
    const rt = framebuffer.renderTextures[rtIdx];

    const name = `IN_${rt.name}`;
    const tex = rt.readTexture;
    gl.activeTexture(gl.TEXTURE0 + texUnit);
    gl.bindTexture(gl.TEXTURE_2D, tex);
    setUniform(p.id, name, { type: "int", value: texUnit });
    texUnit++;
  }

  // bind textures
  for (const [name, value] of Object.entries(p.uniformValues)) {
    if (value.value.type !== "texture") continue;
    const texValue = value.value;

    const texData = textures[texValue.value];

    gl.activeTexture(gl.TEXTURE0 + texUnit);
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, texData.texture);
    setUniform(p.id, name, {
      type: "texture",
      value: texValue.value,
      unit: texUnit,
    });

    texUnit++;
  }

  //TODO upload sampler parameters

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
  // should always be the final pass
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

  // sync render texture read/write textures
  if (p.id !== presentPass) {
    for (const rt of p.outputs) {
      gl.readBuffer(gl.COLOR_ATTACHMENT0 + rt);
      framebuffer.renderTextures[rt].syncBuffers();
    }
  }

  // unbind objects
  gl.useProgram(null);
  gl.bindVertexArray(null);

  // clear per-pass state
  p.instanceCount = 0;
  p.propertyValues = [];
}

function uploadUniformValue(u: UniformValue) {
  //! assumes gl program is bound

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
      break;
    case "texture":
      gl.uniform1i(u.uniform.location, u.value.unit);
      break;
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

  // _INDEX built-in property
  pass.propertyValues.push(r.index);

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
  View.updateScale();
  updateFramebuffer();

  gl.clear(gl.COLOR_BUFFER_BIT);

  gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer.buffer);
  gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT | gl.STENCIL_BUFFER_BIT);

  for (const pass of renderPasses) {
    if (!pass.enabled) continue;
    if (pass.id === presentPass) pass.instanceCount = 1;
    executeRenderPass(pass);
  }

  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
}

function createRenderTexture(name: string): number {
  const rtIdx = framebuffer.renderTextures.findIndex((fb) => fb.name === name);
  if (rtIdx >= 0) return rtIdx;

  if (framebuffer.renderTextures.length === 8) {
    throw new Error(`too many framebuffer attachments (8 max)`);
  }

  const newRt = new RenderTexture(name);
  const idx = framebuffer.renderTextures.length;
  framebuffer.renderTextures.push(newRt);
  return idx;
}

interface Framebuffer {
  size: vec2;
  buffer: WebGLFramebuffer;
  depthStencilBuffer: WebGLRenderbuffer;
  renderTextures: RenderTexture[];
}

function createFramebuffer(rts?: RenderTexture[]): Framebuffer {
  const size = scaleTextureSize(View.renderSize(), 1);

  const fb = gl.createFramebuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER, fb);

  // set up depth stencil buffer
  const depthStencilBuffer = gl.createRenderbuffer();
  gl.bindRenderbuffer(gl.RENDERBUFFER, depthStencilBuffer);
  gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_STENCIL, size[0], size[1]);
  gl.bindRenderbuffer(gl.RENDERBUFFER, null);

  gl.framebufferRenderbuffer(
    gl.FRAMEBUFFER,
    gl.DEPTH_STENCIL_ATTACHMENT,
    gl.RENDERBUFFER,
    depthStencilBuffer,
  );

  // set up render textures
  const renderTextures: RenderTexture[] = rts || [];
  let attachment = 0;
  for (const rt of renderTextures) {
    gl.framebufferTexture2D(
      gl.FRAMEBUFFER,
      gl.COLOR_ATTACHMENT0 + attachment,
      gl.TEXTURE_2D,
      rt.writeTexture,
      0,
    );
    attachment++;
  }

  gl.bindFramebuffer(gl.FRAMEBUFFER, null);

  return { size, buffer: fb, depthStencilBuffer, renderTextures };
}

function updateFramebuffer() {
  const newSize = scaleTextureSize(View.renderSize(), 1);
  const size = framebuffer.size;

  const needResize = size[0] != newSize[0] || size[1] != newSize[1];
  if (!needResize) return;

  View.gl().deleteFramebuffer(framebuffer.buffer);
  View.gl().deleteRenderbuffer(framebuffer.depthStencilBuffer);

  // resize render textures
  for (const rt of framebuffer.renderTextures) {
    rt.updateSize();
  }

  const newBuffer = createFramebuffer(framebuffer.renderTextures);
  framebuffer.buffer = newBuffer.buffer;
  framebuffer.size = newBuffer.size;
}

type ShaderMode = "world" | "fullscreen";

function createGLTexture(size: vec2): WebGLTexture {
  const tex = gl.createTexture();

  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGBA8, size[0], size[1]);
  gl.bindTexture(gl.TEXTURE_2D, null);

  return tex;
}

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
  properties.push({ name: "_INDEX", type: "float", location: 0 });

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
type GLValue = FloatValue | Vec2Value | Mat3Value | IntValue | TextureValue;
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

interface TextureValue {
  type: "texture";
  value: Texture;
  unit: number;
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

class TextureData {
  id: Texture;
  texture: WebGLTexture;
  size: TextureSize;
  layers: number[]; // 0 indicates unused layer, 1 indicates used layer

  constructor(size: TextureSize, layers: number) {
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, tex);
    gl.texStorage3D(gl.TEXTURE_2D_ARRAY, 1, gl.RGBA8, size, size, layers);
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, null);

    this.layers = [];
    for (let i = 0; i < layers; i++) this.layers.push(0);

    this.id = textures.length as Texture;
    this.size = size;
    this.texture = tex;

    textures.push(this);
  }

  addLayer(source: TexImageSource): number {
    let layer = -1;
    for (let i = 0; i < this.layers.length; i++) {
      if (this.layers[i] === 0) {
        layer = i;
        break;
      }
    }

    if (layer === -1) {
      throw new Error(
        `failed to add layer, texture at capacity (${this.layers.length})`,
      );
    }

    this.setLayer(layer, source);
    return layer;
  }

  setLayer(layer: number, source: TexImageSource) {
    this.layers[layer] = 1;

    gl.bindTexture(gl.TEXTURE_2D_ARRAY, this.texture);
    // prettier-ignore
    gl.texSubImage3D(gl.TEXTURE_2D_ARRAY, 0, 0, 0, layer, this.size, this.size, 1, gl.RGBA, gl.UNSIGNED_BYTE, source);
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, null);
  }
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
  writeTexture: WebGLTexture;
  readTexture: WebGLTexture;

  private size: vec2 = [1, 1];

  constructor(name: string) {
    const texSize = scaleTextureSize(View.renderSize(), 1);

    this.name = name;
    this.size = texSize;
    this.writeTexture = createGLTexture(texSize);
    this.readTexture = createGLTexture(texSize);
  }

  updateSize() {
    const newSize = scaleTextureSize(View.renderSize(), 1);
    const size = this.size;

    const needResize = newSize[0] !== size[0] || newSize[1] !== size[1];
    if (!needResize) return;

    gl.deleteTexture(this.writeTexture);
    gl.deleteTexture(this.readTexture);

    this.writeTexture = createGLTexture(newSize);
    this.readTexture = createGLTexture(newSize);

    this.size = newSize;
  }

  syncBuffers() {
    const size = this.size;

    // copy data from writeTexture to readTexture
    gl.bindTexture(gl.TEXTURE_2D, this.readTexture);
    gl.copyTexSubImage2D(gl.TEXTURE_2D, 0, 0, 0, 0, 0, size[0], size[1]);
    gl.bindTexture(gl.TEXTURE_2D, null);
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
  index: number;
  properties: GLValue[] = [];

  private passData: RenderPassData;

  constructor(
    pass: RenderPass,
    options: { depth?: number; index?: number } = {},
  ) {
    super();
    this.pass = pass;
    this.passData = getRenderPassData(pass);
    this.depth = options.depth !== undefined ? options.depth : 1;
    this.index = options.index || 0;
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

function attachModelBuffer(buffer: WebGLBuffer) {
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);

  // _LOCAL_POS
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
  gl.bufferData(gl.ARRAY_BUFFER, verts, gl.STATIC_DRAW);

  gl.bindBuffer(gl.ARRAY_BUFFER, null);
}

const defaultProperties = new Set([
  "_TRANSFORM",
  "_DEPTH",
  "_INDEX",
  "DEPTH",
  "INDEX",
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
  in float _INDEX; // per-instance
  ${attributes}

  out float DEPTH;
  out float INDEX;
  out vec2 SCREEN_POS;
  out vec2 WORLD_POS;
  out vec2 LOCAL_POS;
  ${varyings}

  void main() {
    vec3 world = ${world_pos_calc};

    DEPTH = min(0.0, max(1.0, _DEPTH));
    INDEX = _INDEX;
    SCREEN_POS = ${screen_pos_calc}.xy;
    WORLD_POS = world.xy;
    LOCAL_POS = _LOCAL_POS;

    gl_Position = vec4((SCREEN_POS - 0.5) * 2.0, DEPTH, 1.0);

    ${interpolations}
  }
`;
}

init();
