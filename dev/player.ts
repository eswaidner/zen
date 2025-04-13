import { vec2 } from "gl-matrix";
import { FaceVelocity, Movement } from "./movement";
import { SmoothFollow } from "./camera";
import { createRenderPass, Renderer } from "../src/graphics";
import { Graphics, Input, Schedule, State, Time, Transform } from "../src/zen";
import { Attribute, Entity } from "../src/state";

async function init() {
  const shader = Graphics.createShader(
    `#version 300 es
  precision highp float;

  in vec2 SCREEN_POS;
  in vec2 WORLD_POS;
  in vec2 LOCAL_POS;

  out vec4 OUT_COLOR;
  void main() {
    OUT_COLOR = vec4(LOCAL_POS, 0.0, 1.0);
  }
  `,
    "world",
  );

  const pass = createRenderPass(shader);

  const p = State.createEntity("player");
  State.addAttribute(p, Player, new Player());
  State.addAttribute(p, Transform, new Transform({ pivot: [0.5, 0.5] }));
  State.addAttribute(p, Movement, new Movement({ decay: 0.4, mass: 1 }));
  State.addAttribute(p, FaceVelocity, new FaceVelocity());
  State.addAttribute(p, Renderer, new Renderer(pass));
  State.addAttribute(p, PlayerInput, new PlayerInput());

  Schedule.onSignal(Schedule.update, {
    query: { include: [Player, PlayerInput, Movement] },
    foreach: processInput,
  });

  //TEMP, does not work for multiple targets
  Schedule.onSignal(Schedule.update, {
    query: { include: [SmoothFollow] },
    foreach: (e) => {
      const follow = State.getAttribute<SmoothFollow>(e, SmoothFollow)!;
      follow.target = p;
    },
  });
}

export class Player extends Attribute {}

export class PlayerInput extends Attribute {
  walkForce: number = 4;
}

export function processInput(e: Entity) {
  const playerInput = State.getAttribute<PlayerInput>(e, PlayerInput)!;
  const movement = State.getAttribute<Movement>(e, Movement)!;

  let dx = 0;
  if (Input.isKeyDown("d")) dx += 1;
  if (Input.isKeyDown("a")) dx -= 1;

  let dy = 0;
  if (Input.isKeyDown("w")) dy += 1;
  if (Input.isKeyDown("s")) dy -= 1;

  const walkInput: vec2 = [dx, dy];
  const walkDir = vec2.normalize(vec2.create(), walkInput);
  const forceDelta = vec2.scale(vec2.create(), walkDir, playerInput.walkForce);

  vec2.add(movement.force, movement.force, forceDelta);

  const trs = State.getAttribute<Transform>(e, Transform);
  if (trs) trs.rot += 0.5 * Time.delta();
}

init();
