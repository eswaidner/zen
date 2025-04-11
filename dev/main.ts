import "./style.css";

import "./grid";
import "./camera";
import "./player";
import "./movement.ts";
import { Schedule, Zen } from "../src/zen.ts";

Schedule.onSignal(Schedule.start, { once: () => console.log("START") });
Schedule.onSignal(Schedule.update, { once: () => console.log("UPDATE") });
Schedule.onSignal(Schedule.quit, { once: () => console.log("QUIT") });

Zen.start();
