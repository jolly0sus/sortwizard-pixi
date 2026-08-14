import { createGame } from "./Game.js";
import { layoutStore } from "./editor/overrides.js";
import { mountEditor } from "./editor/panel.js";

// Saved tweaks have to land before the first scene is laid out.
layoutStore.load();

createGame(document.getElementById("pixi-container")).then((game) => {
  mountEditor(game);
});
