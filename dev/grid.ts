import { Zen } from "../src/main";
import { Draw, DrawGroup, Shader } from "../src/zen";
import gridSrc from "./shaders/grid.frag?raw";

const gridShader = new Shader(gridSrc, "fullscreen");

const group = new DrawGroup(gridShader);
group.drawOrder = -1;

Zen.createEntity().addAttribute(DrawGroup, group);
Zen.createEntity().addAttribute(Draw, new Draw(group));
