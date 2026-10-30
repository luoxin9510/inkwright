// Entry of the engine bundle embedded in exported web pages (scripts/engine-bundle.mjs builds it
// into the global `InkwrightGame`). Keep it free of Obsidian and Node APIs.
export { GameEngine } from "./engine";
export { localize } from "./config";
