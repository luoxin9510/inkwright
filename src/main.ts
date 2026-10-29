import { Plugin } from "obsidian";
import { INK_VIEW_TYPE, InkView } from "./views/InkView";

export default class InkCnPlugin extends Plugin {
  async onload(): Promise<void> {
    this.registerView(INK_VIEW_TYPE, (leaf) => new InkView(leaf));
    this.registerExtensions(["ink"], INK_VIEW_TYPE);
  }
}
