import { vec2 } from "gl-matrix";
import { Schedule, View } from "./zen";
import { update } from "./schedule";

const downKeys: Set<string> = new Set();
let keyPressesPrev: Set<string> = new Set();
let keyReleasesPrev: Set<string> = new Set();
let keyPressesNext: Set<string> = new Set();
let keyReleasesNext: Set<string> = new Set();
let _pointerScreenPos: vec2 = [0, 0];
let _pointerWorldPos: vec2 = [0, 0];

function init() {
  const inputSignal = Schedule.signalBefore(update);
  Schedule.onSignal(inputSignal, { once: () => updateInput() });

  window.onkeydown = (e) => {
    const k = e.key.toLowerCase();

    // prevents repeating keydown events from messing up key press state
    if (!downKeys.has(k)) {
      keyPressesNext.add(k);
      downKeys.add(k);
    }
  };

  window.onkeyup = (e) => {
    const k = e.key.toLowerCase();
    downKeys.delete(k);
    keyReleasesNext.add(k);
  };

  // reset key downs when window is hidden
  // prevents keys 'sticking' down when window/tab is hidden
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") downKeys.clear();
  });

  View.gl().canvas.addEventListener("pointermove", (e) => {
    const p = e as PointerEvent;
    _pointerScreenPos[0] = p.offsetX;
    _pointerScreenPos[1] = View.screenSize()[1] - p.offsetY;
    _pointerWorldPos = View.screenToWorld(_pointerScreenPos);
  });
}

export function isKeyDown(key: string): boolean {
  return downKeys.has(key);
}

export function wasKeyPressed(key: string): boolean {
  return keyPressesPrev.has(key);
}

export function wasKeyReleased(key: string): boolean {
  return keyReleasesPrev.has(key);
}

export function pointerScreenPos(): vec2 {
  return vec2.clone(_pointerScreenPos);
}

export function pointerWorldPos(): vec2 {
  return vec2.clone(_pointerWorldPos);
}

function updateInput() {
  //guarantee each key state gets a full frame to be processed before removal
  keyPressesPrev.clear();
  keyReleasesPrev.clear();
  const kpp = keyPressesPrev;
  const krp = keyReleasesPrev;
  keyPressesPrev = keyPressesNext;
  keyReleasesPrev = keyReleasesNext;
  keyPressesNext = kpp;
  keyReleasesNext = krp;
}

init();
