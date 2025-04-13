import { mat2d, vec2 } from "gl-matrix";
import { Transform } from "./transforms";

let _gl: WebGL2RenderingContext;
const _transform: Transform = new Transform({ pivot: [0.5, 0.5] });
let _screenSize: vec2 = [0, 0];
let _renderSize: vec2 = [0, 0];
let _zoom: number = 0.01;

function init() {
  const canvas = document.querySelector("#zen-app")! as HTMLCanvasElement;
  canvas.style.width = "100%";
  canvas.style.height = "100%";

  _gl = canvas.getContext("webgl2")!;
  _gl.clearColor(0.07, 0.07, 0.07, 1);
  _gl.clearDepth(1.0);
  _gl.depthRange(0.0, 1.0);

  new ResizeObserver(onResize).observe(canvas, { box: "content-box" });

  // force a reflow to immediately invoke resize callback
  window.getComputedStyle(canvas).width;
}

export function gl(): WebGL2RenderingContext {
  return _gl;
}

export function transform(): Transform {
  return _transform;
}

export function screenSize(): vec2 {
  return vec2.clone(_screenSize);
}

export function renderSize(): vec2 {
  return vec2.clone(_renderSize);
}

export function zoom(): number {
  return _zoom;
}

export function setZoom(zoom: number) {
  _zoom = zoom;
}

export function updateScale() {
  _transform.scale = [_zoom * _renderSize[0], _zoom * _renderSize[1]];
}

export function screenToWorld(screenPos: vec2): vec2 {
  // normalize coordinates
  const spos = vec2.clone(screenPos);
  spos[0] /= _screenSize[0];
  spos[1] /= _screenSize[1];

  const worldPos = vec2.create();
  const trs = _transform.trs();
  return vec2.transformMat2d(worldPos, spos, trs);
}

export function worldToScreen(worldPos: vec2): vec2 {
  const screenPos = vec2.create();
  const trs = _transform.trs();
  mat2d.invert(trs, trs);
  vec2.transformMat2d(screenPos, worldPos, trs);

  // scale coordinates
  screenPos[0] *= _screenSize[0];
  screenPos[1] *= _screenSize[1];

  return screenPos;
}

// adapted from WebGl2Fundementals
// https://webgl2fundamentals.org/webgl/lessons/webgl-resizing-the-canvas.html
function onResize(entries: ResizeObserverEntry[]) {
  for (const entry of entries) {
    const size = entry.devicePixelContentBoxSize[0];
    const displayWidth = Math.round(size.inlineSize);
    const displayHeight = Math.round(size.blockSize);

    _renderSize[0] = displayWidth;
    _renderSize[1] = displayHeight;
    _screenSize[0] = displayWidth / window.devicePixelRatio;
    _screenSize[1] = displayHeight / window.devicePixelRatio;
    updateScale();

    const needResize =
      _gl.canvas.width !== displayWidth || _gl.canvas.height !== displayHeight;

    if (needResize) {
      _gl.canvas.width = displayWidth;
      _gl.canvas.height = displayHeight;
      _gl.viewport(0, 0, displayWidth, displayHeight);
    }
  }
}

init();
