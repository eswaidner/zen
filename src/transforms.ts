import { mat2d, vec2 } from "gl-matrix";
import { Zen } from "./main";

function init() {
  Zen.defineAttribute(Transform);
}

//TODO parent/child relationships

export class Transform {
  pos: vec2;
  rot: number;
  scale: vec2;
  pivot: vec2;

  constructor(properties?: {
    pos?: vec2;
    rot?: number;
    scale?: vec2;
    pivot?: vec2;
  }) {
    this.pos = properties?.pos || [0, 0];
    this.rot = properties?.rot || 0;
    this.scale = properties?.scale || [1, 1];
    this.pivot = properties?.pivot || [0, 0];
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

  trsi(): mat2d {
    const trs = this.trs();
    return mat2d.invert(trs, trs);
  }
}

init();
