const attributes: Map<object, object> = new Map();
const resources: Map<object, object> = new Map();
let entityCount: number = 0;
let nextEntityId: number = 0;
let shouldExit = false;

function init() {
  defineAttribute(System);

  createResource<Time>(Time, new Time());
}

export function start() {
  shouldExit = false;
  requestAnimationFrame(update);
}

export function stop() {
  shouldExit = true;
}

function update(ts: DOMHighResTimeStamp) {
  if (shouldExit) return;
  requestAnimationFrame(update);

  // skip update if time is undefined (should never happen)
  const t = getResource<Time>(Time);
  if (!t) return;

  const tsSeconds = ts * 0.001;

  if (t.previous === undefined) t.previous = tsSeconds;
  else t.previous = t.current;

  t.current = tsSeconds;
  t.delta = t.current - t.previous;
  t.elapsed += t.delta;

  // update systems
  const sysAttr = getAttribute<System>(System);
  for (const sys of sysAttr!.instances.values()) {
    sys.update(t);
  }
}

export function getEntityCount(): number {
  return entityCount;
}

export function defineAttribute<T extends object>(
  key: object,
  callbacks?: { onAdd?: AttributeCallback<T>; onRemove?: AttributeCallback<T> },
) {
  const attr = new Attribute<T>(callbacks?.onAdd, callbacks?.onRemove);
  attributes.set(key, attr);
}

export function createSystem(
  q: Query,
  args: {
    foreach?: (e: Entity, ctx: SystemContext) => void;
    once?: (ctx: SystemContext) => void;
    name?: string;
    frequency?: number;
  },
): Entity {
  const e = createEntity();
  e.addAttribute<System>(
    System,
    new System(q, args.foreach, args.once, args.frequency),
  );
  return e;
}

export function createResource<T>(key: object, value: T): T {
  if (resources.has(key)) {
    console.log(
      `WARNING: resource of type '${key}' already exists, overwriting`,
    );
  }

  resources.set(key, value as object);
  return value;
}

export function deleteResource(key: object) {
  resources.delete(key);
}

export function getResource<T>(key: object): T | undefined {
  const res = resources.get(key);
  return res ? (res as T) : undefined;
}

export function createEntity(): Entity {
  const ent = new Entity(nextEntityId);
  nextEntityId++; // max safe id is (2^53) – 1
  entityCount++;

  return ent;
}

/** Deletes an entity. Never delete the same entity more than once! */
export function deleteEntity(e: Entity) {
  for (const c of Object.values(attributes)) {
    c.deleteInstance(e.id);
  }

  // NEVER DELETE AN ENTITY MORE THAN ONCE
  entityCount--;
}

export function getAttribute<T extends object>(
  key: object,
): Attribute<T> | undefined {
  const attr = attributes.get(key);

  if (!attr) {
    console.log(`WARNING: undefined attribute '${key}'`);
    return undefined;
  }

  return attr as Attribute<T>;
}

export function query(q: Query): Entity[] {
  if (!q.with || q.with.length === 0) return [];

  if (q.resources) {
    for (const res of q.resources) {
      if (!getResource<object>(res)) return [];
    }
  }

  const base = getAttribute(q.with[0]);
  if (!base) return [];

  const entities: Entity[] = [];

  // check all instances of base attribute for matches
  for (let entId of base.instances.keys()) {
    const ent = new Entity(entId);
    let match = true;

    // reject entity if a required attribute is missing
    for (let j = 1; j < q.with.length; j += 1) {
      const attr = getAttribute(q.with[j]);
      if (!attr?.instances.get(entId)) {
        match = false;
        break;
      }
    }

    // reject entity if an excluded attribute is set
    if (match && q.without) {
      for (let j = 0; j < q.without.length; j += 1) {
        const attr = getAttribute(q.without[j]);
        if (attr && attr.instances.get(entId)) {
          match = false;
          break;
        }
      }
    }

    // add values to query result
    if (match) entities.push(ent);
  }

  return entities;
}

type AttributeCallback<T extends object> = (a: T) => void;

class Attribute<T extends object> {
  instances: Map<number, T> = new Map();
  onAdd?: AttributeCallback<T>;
  onRemove?: AttributeCallback<T>;

  constructor(onAdd?: AttributeCallback<T>, onRemove?: AttributeCallback<T>) {
    this.onAdd = onAdd;
    this.onRemove = onRemove;
  }

  removeInstance(entId: number) {
    if (!this.instances.has(entId)) return;

    if (this.onRemove) this.onRemove(this.instances.get(entId)!);
    this.instances.delete(entId);
  }
}

export interface Query {
  with?: object[];
  without?: object[];
  resources?: object[];
}

export class Entity {
  id: number;

  constructor(id: number) {
    this.id = id;
  }

  getAttribute<T extends object>(key: object): T | undefined {
    const attr = getAttribute<T>(key);
    return attr?.instances.get(this.id);
  }

  addAttribute<T extends object>(key: object, value: T): Entity {
    const attr = getAttribute<T>(key);
    attr?.instances.set(this.id, value);
    return this;
  }

  removeAttribute(key: object): Entity {
    const attr = getAttribute(key);
    attr?.removeInstance(this.id);
    return this;
  }
}

export class System {
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
    this.query = q;
    this.foreach = foreach;
    this.once = once;

    if (frequency) this.interval = 1 / frequency;
  }

  update(t: Time) {
    this.elapsedInterval += t.delta;
    if (this.elapsedInterval > this.interval) this.execute();
  }

  execute() {
    // invoke fn for each entity returned by query
    const q = query(this.query);
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

export interface SystemContext {
  entities: Entity[];
  deltaTime: number;
}

export class Time {
  elapsed: number = 0;
  delta: number = 0;
  previous: DOMHighResTimeStamp = 0;
  current: DOMHighResTimeStamp = 0;
}

init();
