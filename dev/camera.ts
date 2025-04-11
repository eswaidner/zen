import { vec2 } from "gl-matrix";
import { Attribute, Entity, query } from "../src/state";
import { TaskContext } from "../src/schedule";
import { Schedule, State, Transform, View } from "../src/zen";

function input() {
  Schedule.onSignal(Schedule.update, {
    query: { include: [SmoothFollow, Transform] },
    foreach: follow,
  });

  const followEnt = State.createEntity();
  State.addAttribute(followEnt, Camera, new Camera());
  State.addAttribute(followEnt, SmoothFollow, new SmoothFollow({ speed: 8 }));
  State.addAttribute(followEnt, Transform, new Transform());

  Schedule.onSignal(Schedule.update, {
    query: { include: [Camera, Transform] },

    foreach: (e) => {
      const trs = State.getAttribute<Transform>(e, Transform)!;

      View.transform().pos = vec2.clone(trs.pos);
      View.transform().rot = trs.rot;
    },
  });
}

export class Camera extends Attribute {}

export class SmoothFollow extends Attribute {
  speed: number;
  target?: Entity;

  constructor(options: { speed: number }) {
    super();
    this.speed = options.speed;
  }
}

function follow(e: Entity, ctx: TaskContext) {
  const follow = State.getAttribute<SmoothFollow>(e, SmoothFollow)!;
  const trs = State.getAttribute<Transform>(e, Transform)!;

  if (!follow.target) return;

  const targetTrs = State.getAttribute<Transform>(follow.target, Transform);
  if (!targetTrs) return;

  const sqDist = vec2.sqrDist(targetTrs.pos, trs.pos);

  if (sqDist > 0.005) {
    vec2.lerp(trs.pos, trs.pos, targetTrs.pos, follow.speed * ctx.deltaTime);
  }
}

input();
