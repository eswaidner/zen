import { Graphics, State } from "../src/zen";

import gridSrc from "./shaders/grid.frag?raw";

const gridShader = Graphics.createShader(gridSrc, "fullscreen", {
  outputs: { COLOR: "vec4" },
});
const pass = Graphics.createRenderPass(gridShader, { drawOrder: -1 });

const e = State.createEntity();
State.addAttribute(e, Graphics.Renderer, new Graphics.Renderer(pass));
