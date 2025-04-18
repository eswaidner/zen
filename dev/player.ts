import { vec2, vec3 } from "gl-matrix";
import { FaceVelocity, Movement } from "./movement";
import { SmoothFollow } from "./camera";
import {
  Attribute,
  Entity,
  Graphics,
  Input,
  Renderer,
  Schedule,
  State,
  Time,
  Transform,
} from "../src/zen";

async function init() {
  const shader = Graphics.createShader(
    `#version 300 es
  precision highp float;
  precision highp sampler2DArray;

  in vec2 SCREEN_POS;
  in vec2 WORLD_POS;
  in vec2 LOCAL_POS;
  in float INDEX;

  uniform sampler2DArray sprites;

  out vec4 OUT_COLOR;
  void main() {
    // OUT_COLOR = vec4(LOCAL_POS, 0.0, 1.0);
    OUT_COLOR = texture(sprites, vec3(LOCAL_POS, INDEX));
  }
  `,
    "world",
    { uniforms: { sprites: "sampler2DArray" } },
  );

  const playerImg = new Image();
  playerImg.src = "./chrome_icon.png";

  playerImg.addEventListener("load", () => {
    const idx = Graphics.addTextureLayer(sprites, playerImg);
  });

  const sprites = Graphics.createTexture(256, 1);

  const pass = Graphics.createRenderPass(shader, {
    outputs: { COLOR: "COLOR" },
    blend: { src: "src-alpha", dest: "one-minus-src-alpha" },
  });

  Graphics.setUniform(pass, "sprites", {
    type: "texture",
    value: sprites,
    unit: 0,
  });

  const p = State.createEntity("player");
  State.addAttribute(p, Player, new Player());
  State.addAttribute(p, Transform, new Transform({ pivot: [0.5, 0.5] }));
  State.addAttribute(p, Movement, new Movement({ decay: 0.4, mass: 1 }));
  State.addAttribute(p, FaceVelocity, new FaceVelocity());
  State.addAttribute(p, Renderer, new Renderer(pass, { index: 0 }));
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
