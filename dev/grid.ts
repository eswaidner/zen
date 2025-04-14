import { Graphics, State } from "../src/zen";

//@ts-expect-error shader file not auto-detected
import gridSrc from "./shaders/grid.frag?raw";

const gridShader = Graphics.createShader(gridSrc, "fullscreen", {
  inputs: ["COLOR"],
});
const pass = Graphics.createRenderPass(gridShader, { drawOrder: -1 });

const e = State.createEntity();
State.addAttribute(e, Graphics.Renderer, new Graphics.Renderer(pass));
