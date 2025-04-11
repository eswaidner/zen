import { Entity, Query } from "./state";
import { State, Time } from "./zen";

const tasks: TaskState[] = [];
let nextTaskId: number = 0;

const OpaqueTask = Symbol(); // opaque type tag
export type Task = number & { [OpaqueTask]: never };

const OpaqueSignal = Symbol(); // opaque type tag
export type Signal = number & { [OpaqueSignal]: never };

export function afterDelay(): Task {
  //TODO
  return 0 as Task;
}

export function onSignal(): Task {
  //TODO
  return 0 as Task;
}

//TODO SIGNALS

export function cancel(system: Task) {
  const s = tasks.findIndex((sys) => sys.id === system);
  if (s < 0) return;

  tasks.splice(s, 1);
}

// register update callback
Time.onUpdate(update);
function update() {
  // update systems
  for (let i = 0; i < tasks.length; i++) {
    tasks[i].update();
  }
}

export interface SystemContext {
  entities: Entity[];
  deltaTime: number;
}

class TaskState {
  id: Task;
  interval: number = 0;
  elapsedInterval: number = 0;
  query: Query;
  foreach?: (e: Entity, ctx: SystemContext) => void;
  once?: (ctx: SystemContext) => void;

  constructor(
    q: Query,
    foreach?: (e: Entity, ctx: SystemContext) => void,
    once?: (ctx: SystemContext) => void,
    frequency?: number,
  ) {
    const s = nextTaskId as Task;
    nextTaskId++;

    this.id = s;
    this.query = q;
    this.foreach = foreach;
    this.once = once;

    if (frequency) this.interval = 1 / frequency;

    tasks.push(this);
  }

  update() {
    this.elapsedInterval += Time.delta();
    if (this.elapsedInterval > this.interval) this.execute();
  }

  execute() {
    // invoke fn for each entity returned by query
    const q = State.query(this.query);
    const len = q.length;

    const ctx = { entities: q, deltaTime: this.elapsedInterval };

    if (this.foreach) {
      for (let i = 0; i < len; i++) {
        this.foreach(q[i], ctx);
      }
    }

    if (this.once) this.once(ctx);

    this.elapsedInterval = 0;
  }
}
