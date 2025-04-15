import "./style.css";

import "./grid";
import "./camera";
import "./player";
import "./movement.ts";
import { Graphics, Zen } from "../src/zen.ts";

Graphics.setBackgroundColor([0.07, 0.07, 0.07, 1]);
Zen.start();
