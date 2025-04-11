import { vec2 } from "gl-matrix";

function init() {
  Zen.createResource<Input>(Input, new Input());

  Zen.createSystem({ resources: [Input, Viewport] }, { once: updateInput });
}

function updateInput() {
  const input = Zen.getResource<Input>(Input)!;
  const vp = Zen.getResource<Viewport>(Viewport)!;

  if (!input.initialized) initInput(input, vp);

  //guarantee each key state gets a full frame to be processed before removal
  input.keyPressesPrev.clear();
  input.keyReleasesPrev.clear();
  const kpp = input.keyPressesPrev;
  const krp = input.keyReleasesPrev;
  input.keyPressesPrev = input.keyPressesNext;
  input.keyReleasesPrev = input.keyReleasesNext;
  input.keyPressesNext = kpp;
  input.keyReleasesNext = krp;
}

function initInput(input: Input, vp: Viewport) {
  window.onkeydown = (e) => {
    const k = e.key.toLowerCase();

    // prevents repeating keydown events from messing up key press state
    if (!input.downKeys.has(k)) {
      input.keyPressesNext.add(k);
      input.downKeys.add(k);
    }
  };

  window.onkeyup = (e) => {
    const k = e.key.toLowerCase();
    input.downKeys.delete(k);
    input.keyReleasesNext.add(k);
  };

  // reset key downs when window is hidden
  // prevents keys 'sticking' down when window/tab is hidden
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") input.downKeys.clear();
  });

  vp.gl.canvas.addEventListener("pointermove", (e) => {
    const ev = e as PointerEvent;
    input.pointerScreenPos[0] = ev.offsetX;
    input.pointerScreenPos[1] = vp.screen[1] - ev.offsetY;
    input.pointerWorldPos = vp.screenToWorld(input.pointerScreenPos);
  });

  input.initialized = true;
}

export class Input {
  initialized: boolean = false;
  downKeys: Set<string> = new Set();
  keyPressesPrev: Set<string> = new Set();
  keyReleasesPrev: Set<string> = new Set();
  keyPressesNext: Set<string> = new Set();
  keyReleasesNext: Set<string> = new Set();
  pointerScreenPos: vec2 = [0, 0];
  pointerWorldPos: vec2 = [0, 0];

  isKeyDown(key: string): boolean {
    return this.downKeys.has(key);
  }

  wasKeyPressed(key: string): boolean {
    return this.keyPressesPrev.has(key);
  }

  wasKeyReleased(key: string): boolean {
    return this.keyReleasesPrev.has(key);
  }
}

init();
