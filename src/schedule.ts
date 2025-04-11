import { Entity, Query } from "./state";
import { State, Time } from "./zen";

const defaultMaxUpdateSteps = 10;

const tasks: Map<Task, TaskState> = new Map();
const taskDelays: Map<Task, Delay> = new Map();
let nextTaskId: number = 0;

const signals: SignalState[] = [];
const signalIntervals: SignalTimestep[] = [];
let nextSignalId: number = 0;

const OpaqueTask = Symbol(); // opaque type tag
export type Task = number & { [OpaqueTask]: never };

const OpaqueSignal = Symbol(); // opaque type tag
export type Signal = number & { [OpaqueSignal]: never };

export interface TaskOptions {
  query?: Query;
  foreach?: (e: Entity, ctx: TaskContext) => void;
  once?: (ctx: TaskContext) => void;
}

export function onSignal(signal: Signal, task: TaskOptions): Task {
  const signalState = getSignalState(signal);

  const t = createTask(task);
  signalState.tasks.push(t);

  return t;
}

export function afterDelay(duration: number, task: TaskOptions): Task {
  const t = createTask(task);
  taskDelays.set(t, { duration, elapsed: 0 });
  return t;
}

export function cancelTask(task: Task) {
  tasks.delete(task);
  taskDelays.delete(task);
}

export function signal(options: {
  frequency?: number;
  maxSteps?: number;
}): Signal {
  const s = createSignal();

  // invoke signal on a fixed timestep
  if (options.frequency && options.frequency > 0) {
    const maxSteps = Math.max(1, options.maxSteps || defaultMaxUpdateSteps);

    signalIntervals.push({
      signal: s,
      duration: 1 / options.frequency,
      elapsed: 0,
      maxSteps,
    });
  }

  return s;
}

export function signalBefore(signal: Signal): Signal {
  const s = createSignal();
  getSignalState(signal).precededBy.push(signal);
  return s;
}

export function signalAfter(signal: Signal): Signal {
  const s = createSignal();
  getSignalState(signal).followedBy.push(signal);
  return s;
}

export function invokeSignal(signal: Signal) {
  executeSignal(signal);
}

function getSignalState(signal: Signal): SignalState {
  // signals cannot be deleted, so this should never fail
  return signals.find((s) => s.id === signal)!;
}

function createTask(options: TaskOptions): Task {
  const t = nextTaskId as Task;
  nextTaskId++;

  const task: TaskState = {
    id: t,
    query: options.query,
    foreach: options.foreach,
    once: options.once,
  };

  tasks.set(t, task);

  return t;
}

function createSignal(): Signal {
  const s = nextSignalId as Signal;
  nextSignalId++;

  const sig: SignalState = {
    id: s,
    timeSinceRun: 0,
    tasks: [],
    precededBy: [],
    followedBy: [],
  };

  signals.push(sig);

  return s;
}

Time.onUpdate(() => {
  for (const [task, delay] of taskDelays) {
    updateDelay(task, delay);
  }

  for (let i = 0; i < signals.length; i++) {
    updateSignalState(signals[i]);
  }

  for (let i = 0; i < signalIntervals.length; i++) {
    updateSignalInterval(signalIntervals[i]);
  }
});

interface TaskState {
  id: Task;
  query?: Query;
  foreach?: (e: Entity, ctx: TaskContext) => void;
  once?: (ctx: TaskContext) => void;
}

interface Delay {
  duration: number;
  elapsed: number;
}

export interface TaskContext {
  entities: Entity[];
  deltaTime: number;
  fixedDeltaTime: number;
}

interface SignalState {
  id: Signal;
  timeSinceRun: number;
  precededBy: Signal[];
  followedBy: Signal[];
  tasks: Task[];
}

interface SignalTimestep {
  signal: Signal;
  duration: number;
  elapsed: number;
  maxSteps: number;
}

function updateDelay(task: Task, delay: Delay) {
  delay.elapsed += Time.delta();
  if (delay.elapsed > delay.duration) {
    executeTask(tasks.get(task)!, delay.duration, 0);
    cancelTask(task);
  }
}

function executeTask(
  task: TaskState,
  deltaTime: number,
  fixedDeltaTime: number,
) {
  const q = task.query ? State.query(task.query) : [];
  const len = q.length;

  const ctx: TaskContext = { entities: q, deltaTime, fixedDeltaTime };

  if (task.foreach) {
    for (let i = 0; i < len; i++) {
      task.foreach(q[i], ctx);
    }
  }

  if (task.once) task.once(ctx);
}

function updateSignalState(signal: SignalState) {
  signal.timeSinceRun += Time.delta();
}

function updateSignalInterval(interval: SignalTimestep) {
  interval.elapsed += Time.delta();

  const fractionalSteps = interval.elapsed / interval.duration;
  const steps = Math.floor(fractionalSteps);
  const remainingTime = (fractionalSteps - steps) * interval.duration;

  for (let i = 0; i < steps; i++) {
    executeSignal(interval.signal, interval.duration);
  }

  interval.elapsed = remainingTime;
}

function executeSignal(signal: Signal, fixedDeltaTime: number = 0) {
  const signalState = getSignalState(signal);

  // execute preceding signals
  for (const s of signalState.precededBy) {
    executeSignal(s, fixedDeltaTime);
  }

  const len = signalState.tasks.length;
  for (let i = len; i >= 0; i--) {
    const t = tasks.get(signalState.tasks[i]);

    // remove canceled tasks
    if (!t) {
      signalState.tasks.splice(i, 1);
      continue;
    }

    executeTask(t, signalState.timeSinceRun, fixedDeltaTime);
  }

  // execute following signals
  for (const s of signalState.followedBy) {
    executeSignal(s, fixedDeltaTime);
  }

  signalState.timeSinceRun = 0;
}
