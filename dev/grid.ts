import { Graphics, State } from "../src/zen";

import gridSrc from "./shaders/grid.frag?raw";
const gridShader = new Graphics.Shader(gridSrc, "fullscreen");

const pass = new Graphics.RenderPass(gridShader);
pass.drawOrder = -1;

const e = State.createEntity();
State.addAttribute(e, Graphics.RenderPass, pass);
State.addAttribute(e, Graphics.Renderer, new Graphics.Renderer(pass));
