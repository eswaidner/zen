import { mat2d, vec2 } from "gl-matrix";
import { Attribute, Entity, Schedule, State } from "./zen";

function init() {
  const transformSync = Schedule.signalAfter(Schedule.update);
  Schedule.onSignal(transformSync, {
    query: {
      include: [Transform],
    },
    foreach: applyTransforms,
  });
}

function applyTransforms(e: Entity) {
  const transform = State.getAttribute<Transform>(e, Transform)!;
  transform.updateWorldTrs();
}

export class Transform extends Attribute {
  pos: vec2;
  rot: number;
  scale: vec2;
  pivot: vec2;

  private _parent: Transform | null = null;
  private children: Transform[] = [];
  private _worldTrs: mat2d = mat2d.create();

  constructor(
    properties: {
      pos?: vec2;
      rot?: number;
      scale?: vec2;
      pivot?: vec2;
      parent?: Transform;
    } = {},
  ) {
    super();
    this.pos = properties.pos || [0, 0];
    this.rot = properties.rot || 0;
    this.scale = properties.scale || [1, 1];
    this.pivot = properties.pivot || [0, 0];
    this.setParent(properties.parent || null);
    this.updateWorldTrs();
  }

  trs(): mat2d {
    const offset = vec2.create();
    vec2.add(offset, this.pos, this.pivot);

    const p = mat2d.create();
    mat2d.translate(p, p, offset);

    const m = mat2d.create();
    mat2d.mul(m, m, p);
    mat2d.scale(m, m, this.scale);
    mat2d.rotate(m, m, this.rot);
    mat2d.translate(m, m, this.pos);
    mat2d.mul(m, m, mat2d.invert(p, p));

    return m;
  }

  inverseTrs(): mat2d {
    const trs = this.trs();
    return mat2d.invert(trs, trs);
  }

  worldTrs(): mat2d {
    return this._worldTrs;
  }

  parent(): Transform | null {
    return this._parent;
  }

  setParent(parent: Transform | null) {
    //! NEVER CREATE A CIRCULAR RELATIONSHIP

    if (parent === this._parent) return;

    // remove current parent
    if (this._parent) {
      let childIndex = this._parent.children.findIndex((c) => c === this);
      this._parent.children.splice(childIndex, 1);
      this._parent = null;
    }

    this._parent = parent;
    if (parent) parent.children.push();
  }

  updateWorldTrs() {
    if (this._parent) {
      mat2d.multiply(this._worldTrs, this._parent._worldTrs, this.trs());
    } else {
      this._worldTrs = this.trs();
    }

    for (let i = 0; i < this.children.length; i++) {
      this.children[i].updateWorldTrs();
    }
  }

  //TODO world pos/rot/scale
}

init();
