import * as Zen from "./zen";

function init() {
  Zen.createResource(Assets, new Assets());
}

export class Assets {}

init();
