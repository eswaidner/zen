const entities: Set<Entity> = new Set();
const namedEntities: Map<string, Entity> = new Map();
const entityNames: Map<Entity, string> = new Map();
let nextEntityId: number = 0;

const attributes: Map<object, object> = new Map();

const Opaque = Symbol(); // opaque type tag
export type Entity = number & { [Opaque]: never };

export function entityCount(): number {
  return entities.size;
}

export function entityExists(ent: Entity): boolean {
  return entities.has(ent);
}

export abstract class Attribute {
  onRemove() {}
}

export function createEntity(name?: string): Entity {
  const ent = nextEntityId as Entity;
  nextEntityId++; // max safe id is (2^53) – 1

  entities.add(ent);
  if (name) {
    namedEntities.set(name, ent);
    entityNames.set(ent, name);
  }

  return ent;
}

export function deleteEntity(ent: Entity) {
  for (const a of attributes.values()) {
    (a as AttributeStorage<any>).remove(ent);
  }

  entities.delete(ent);

  const name = entityNames.get(ent);
  if (name) {
    namedEntities.delete(name);
    entityNames.delete(ent);
  }
}

export function getEntity(name: string): Entity | undefined {
  return namedEntities.get(name);
}

export function getAttribute<T extends Attribute>(
  ent: Entity,
  key: object,
): T | undefined {
  return getAttributeStorage(key).get(ent) as T;
}

export function addAttribute<T extends Attribute>(
  ent: Entity,
  key: object,
  value: T,
) {
  getAttributeStorage(key).add(ent, value);
}

export function removeAttribute(ent: Entity, key: object) {
  getAttributeStorage(key).remove(ent);
}

export interface Query {
  include: object[];
  exclude?: object[];
  filter?: (e: Entity) => boolean;
}

export function query(q: Query): Entity[] {
  if (q.include.length === 0) return [];

  const base = getAttributeStorage(q.include[0]);
  if (!base) return [];

  const entities: Entity[] = [];

  // check all instances of base attribute for matches
  for (let e of base.keys()) {
    let match = true;

    // reject entity if a required attribute is missing
    for (let j = 1; j < q.include.length; j += 1) {
      const attr = getAttributeStorage(q.include[j]);
      if (!attr?.get(e)) {
        match = false;
        break;
      }
    }

    // reject entity if an excluded attribute is present
    if (match && q.exclude) {
      for (let j = 0; j < q.exclude.length; j += 1) {
        const attr = getAttributeStorage(q.exclude[j]);
        if (attr?.get(e)) {
          match = false;
          break;
        }
      }
    }

    // reject entity if filter function returns false
    if (match && q.filter && !q.filter(e)) match = false;

    // add values to query result
    if (match) entities.push(e);
  }

  return entities;
}

// gets or defines attribute
function getAttributeStorage<T extends Attribute>(
  key: object,
): AttributeStorage<T> {
  const existing = attributes.get(key);
  if (existing) return existing as AttributeStorage<T>;

  const attr = new AttributeStorage<T>();
  attributes.set(key, attr);
  return attr;
}

class AttributeStorage<T extends Attribute> {
  private instances: Map<Entity, T> = new Map();

  get(ent: Entity): T | undefined {
    return this.instances.get(ent);
  }

  add(ent: Entity, attr: T) {
    if (!entityExists(ent)) return;
    this.instances.set(ent, attr);
  }

  remove(ent: Entity) {
    const attr = this.instances.get(ent);
    if (!attr) return;

    attr.onRemove();
    this.instances.delete(ent);
  }

  keys() {
    return this.instances.keys();
  }
}
