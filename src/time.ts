let elapsedTime: number = 0;
let deltaTime: number = 0;
let currentTime: DOMHighResTimeStamp = 0;
let previousTime: DOMHighResTimeStamp = 0;

const startCallbacks: Callback[] = [];
const updateCallbacks: Callback[] = [];
const quitCallbacks: Callback[] = [];

let shouldExit = false;

export function elapsed(): number {
  return elapsedTime;
}

export function delta(): number {
  return deltaTime;
}

export function current(): number {
  return currentTime;
}

export function previous(): number {
  return previousTime;
}

export function start() {
  shouldExit = false;
  requestAnimationFrame(update);

  for (const c of startCallbacks) c();
}

export function quit() {
  shouldExit = true;

  for (const c of quitCallbacks) c();
}

function update(ts: DOMHighResTimeStamp) {
  if (shouldExit) return;
  requestAnimationFrame(update);

  const tsSeconds = ts * 0.001;

  if (previousTime === undefined) previousTime = tsSeconds;
  else previousTime = currentTime;

  currentTime = tsSeconds;
  deltaTime = currentTime - previousTime;
  elapsedTime += deltaTime;

  for (const c of updateCallbacks) c();
}

export type Callback = () => void;

export function onStart(callback: Callback) {
  startCallbacks.push(callback);
}

export function onUpdate(callback: Callback) {
  updateCallbacks.push(callback);
}

export function onQuit(callback: Callback) {
  quitCallbacks.push(callback);
}
