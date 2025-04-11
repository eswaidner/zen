import { vec2 } from "gl-matrix";
import { Schedule, State, Transform } from "../src/zen";
import { Attribute, Entity } from "../src/state";
import { TaskContext } from "../src/schedule";

function init() {
  // Zen.defineAttribute<Height>(Height, {
  //   onRemove: (h) => h.shadow?.destroy(),
  // });

  Schedule.onSignal(Schedule.update, {
    query: { include: [Movement, Transform] },
    foreach: move,
  });

  Schedule.onSignal(Schedule.update, {
    query: { include: [FaceVelocity, Movement, Transform] },
    foreach: faceVelocity,
  });

  // Zen.createSystem(
  //   { with: [Height, Transform], resources: [Viewport] },
  //   { foreach: updateHeight },
  // );
}

export class Airborne extends Attribute {}
export class FaceVelocity extends Attribute {}

export class Movement extends Attribute {
  decay: number;
  mass: number;
  force: vec2 = [0, 0];
  velocity: vec2 = [0, 0];
  maxSpeed?: number;

  constructor(options: { decay: number; mass: number }) {
    super();
    this.decay = options.decay;
    this.mass = options.mass;
  }
}

// export class Height {
//   height: number = 0;
//   shadowOffset: vec2;
//   shadow?: Graphics;

//   constructor(shadowOffset: Vector) {
//     this.shadowOffset = shadowOffset;
//   }
// }

// export class Gravity {
//   decay: number;
//   velocity: number = 0;

//   constructor(decay: number) {
//     this.decay = decay;
//   }
// }

function move(e: Entity, ctx: TaskContext) {
  const movement = State.getAttribute<Movement>(e, Movement)!;
  const trs = State.getAttribute<Transform>(e, Transform)!;

  const accel = vec2.scale(vec2.create(), movement.force, 1 / movement.mass);
  const decel = vec2.scale(vec2.create(), movement.velocity, movement.decay);

  vec2.add(movement.velocity, movement.velocity, accel);
  vec2.sub(movement.velocity, movement.velocity, decel);

  //TODO limit velocity to max speed

  // apply velocity
  const moveDelta = vec2.scale(vec2.create(), movement.velocity, ctx.deltaTime);
  vec2.add(trs.pos, trs.pos, moveDelta);

  vec2.zero(movement.force);
}

function faceVelocity(e: Entity) {
  const movement = State.getAttribute<Movement>(e, Movement)!;
  const trs = State.getAttribute<Transform>(e, Transform)!;

  if (movement.velocity[0] === 0) return;
  if (Math.sign(trs.scale[0]) != Math.sign(movement.velocity[0])) {
    trs.scale[0] *= -1;
  }
}

// function updateHeight(e: Zen.Entity, ctx: Zen.SystemContext) {
//   const height = e.getAttribute<Height>(Height)!;
//   const trs = e.getAttribute<Transform>(Transform)!;
//   const so = e.getAttribute<SceneObject>(SceneObject)!;

//   height.height = Math.max(height.height, 0);

//   if (!height.shadow) {
//     const shadow = new Graphics()
//       .ellipse(0, 0, so.container.width * 0.5, so.container.width * 0.2)
//       .fill(0x202020);

//     shadow.zIndex = -Infinity;
//     shadow.alpha = 0.1;

//     Zen.getResource<WorldOrigin>(WorldOrigin)?.container.addChild(shadow);

//     height.shadow = shadow;
//   }

//   const scaleSign = Math.sign(so.container.scale.x);
//   height.shadow.x = trs.pos.x + height.shadowOffset.x * scaleSign;
//   height.shadow.y = trs.pos.y + height.shadowOffset.y;
//   so.container.pivot.y = height.height;

//   height.shadow.scale = 1 + height.height * 0.001;
//   height.shadow.alpha = 0.1 + height.height * 0.0004;

//   if (height.height > 0) e.addAttribute(Airborne, {});
//   else e.removeAttribute(Airborne);

//   const grav = e.getAttribute<Gravity>(Gravity);
//   if (grav) {
//     grav.velocity -= grav.velocity * grav.decay * ctx.deltaTime;
//     grav.velocity = grav.velocity - 65 * ctx.deltaTime;
//     height.height += grav.velocity;

//     if (height.height <= 0) {
//       height.height = 0;
//       grav.velocity = 0;
//     }
//   }

//   if (e.getAttribute(Dead)) {
//     height.height = 0;
//     height.shadow.visible = false;
//   } else {
//     height.shadow.visible = true;
//   }
// }

init();
