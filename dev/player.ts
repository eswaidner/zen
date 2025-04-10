import { Zen } from "../src/main";
import { vec2 } from "gl-matrix";
import { Draw, DrawGroup, Input, Shader, Transform } from "../src/zen";
import { FaceVelocity, Movement } from "./movement";
import { SmoothFollow } from "./camera";

async function init() {
  Zen.defineAttribute(Player);

  const shader = new Shader(
    `#version 300 es
  precision highp float;

  in vec2 SCREEN_POS;
  in vec2 WORLD_POS;
  in vec2 LOCAL_POS;

  out vec4 color;
  void main() {
    color = vec4(LOCAL_POS, 0.0, 1.0);
  }
  `,
    "world",
  );

  const g = new DrawGroup(shader);
  Zen.createEntity().addAttribute(DrawGroup, g);

  const playerEntity = Zen.createEntity()
    .addAttribute(Player, new Player())
    .addAttribute(Transform, new Transform({ pivot: [0.5, 0.5] }))
    .addAttribute(Movement, new Movement({ decay: 0.4, mass: 1 }))
    .addAttribute(FaceVelocity, new FaceVelocity())
    .addAttribute(Draw, new Draw(g));

  Zen.createResource(PlayerEntity, new PlayerEntity(playerEntity));
  Zen.createResource(PlayerInput, new PlayerInput());

  Zen.createSystem(
    { with: [Player, Movement], resources: [PlayerInput, Input] },
    { foreach: processInput },
  );

  //TEMP, does not work for multiple targets
  Zen.createSystem(
    { with: [SmoothFollow] },
    {
      foreach: (e) => {
        const follow = e.getAttribute<SmoothFollow>(SmoothFollow)!;
        follow.target = playerEntity;
      },
    },
  );
}

export class Player {}

export class PlayerEntity {
  entity: Zen.Entity;

  constructor(e: Zen.Entity) {
    this.entity = e;
  }
}

export class PlayerInput {
  //TODO move to a behavior attribute
  walkForce: number = 4;
}

export function processInput(e: Zen.Entity) {
  const input = Zen.getResource<Input>(Input)!;
  const playerInput = Zen.getResource<PlayerInput>(PlayerInput)!;
  const movement = e.getAttribute<Movement>(Movement)!;

  let dx = 0;
  if (input.isKeyDown("d")) dx += 1;
  if (input.isKeyDown("a")) dx -= 1;

  let dy = 0;
  if (input.isKeyDown("w")) dy += 1;
  if (input.isKeyDown("s")) dy -= 1;

  const walkInput: vec2 = [dx, dy];
  const walkDir = vec2.normalize(vec2.create(), walkInput);
  const forceDelta = vec2.scale(vec2.create(), walkDir, playerInput.walkForce);

  vec2.add(movement.force, movement.force, forceDelta);
}

init();
