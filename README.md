# Inkwright

**Write, playtest and debug [ink](https://github.com/inkle/ink) interactive fiction in Obsidian.** Chinese and English interface.

在 Obsidian 里编写、试玩和调试 [ink](https://github.com/inkle/ink) 互动小说的插件,中英双语界面。桌面端和手机端都能用。

## 功能(第一期)

- 在 vault 里直接打开、编辑 `.ink` 文件,带语法高亮。
- 试玩面板:改动保存后自动重新编译,点击选项推进,可"重新开始"。
- 编译报错显示为中文(未收录的报错保留英文原文),点击报错跳到对应文件和行。
- `INCLUDE` 多文件剧本:路径相对于**主剧本所在文件夹**解析,与 Inky / inklecate 一致。
- 主剧本锁定:锁定后切去编辑任何子文件,试玩面板仍运行主剧本。

## 使用

- 打开试玩面板:左侧功能区的 ▶ 图标,或命令"打开试玩面板"。
- 命令"将当前文件锁定为主剧本" / "解除主剧本锁定",或用面板上的按钮。
- 编辑后约 2 秒(Obsidian 自动保存)面板会自动更新,重新编译后故事从头开始。

## 开发

```bash
npm install
npm test          # 单元测试
npm run build     # 类型检查 + 打包出 main.js
OBSIDIAN_PLUGIN_DIR=/path/to/vault/.obsidian/plugins/inkwright npm run dev   # 监听构建,直接输出到 vault
```

## 安装到 vault

把 `main.js`、`manifest.json`、`styles.css` 复制到 `<vault>/.obsidian/plugins/inkwright/`,在 Obsidian 设置的"第三方插件"中启用。手机端通过你的 vault 同步方式把这个文件夹同步过去即可。

## 通过 BRAT 安装(桌面和手机)

1. 在社区插件市场安装并启用 **BRAT**(Obsidian42 - BRAT)。
2. BRAT 设置 → "Add Beta plugin",填入 `luoxin9510/inkwright`。
3. 在第三方插件列表里启用"Inkwright"。之后发布新版本时 BRAT 会自动更新。

## 许可证

MIT。剧本引擎使用 [inkjs](https://github.com/y-lohse/inkjs)(MIT)。
