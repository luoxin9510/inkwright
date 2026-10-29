# ink-cn 第一期 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 一个 Obsidian 插件:在 vault 里编辑 `.ink` 剧本(带高亮),支持 `INCLUDE` 多文件和主剧本锁定,在侧边面板里试玩,并显示中文编译报错。桌面与手机都能用。

**Architecture:** 纯逻辑(路径、`INCLUDE` 预加载、报错解析与翻译、编译、试玩会话、高亮分词、主剧本规则)全部写成不依赖 Obsidian 的 TypeScript 模块,用 vitest 在 Node 里测试。Obsidian 相关代码(编辑视图、试玩面板、插件入口)只做薄薄一层接线,靠手动验证。编译走 `inkjs/full`,`INCLUDE` 靠"先异步预加载进缓存、再由同步的文件处理器读缓存"解决。

**Tech Stack:** TypeScript、esbuild、vitest、`obsidian` 类型包、`inkjs`(^2.4.0,用 `inkjs/full` 入口)、CodeMirror 6(`@codemirror/state|view|commands`,构建时标为 external,由 Obsidian 提供)。

**Spec:** `docs/superpowers/specs/2026-10-29-ink-cn-design.md`

## Global Constraints

- `manifest.json`:`id` 为 `ink-cn`,`isDesktopOnly` 为 `false`;id 不含 `obsidian`。
- `src/` 里禁止使用 Node/Electron API(`fs`、`path`、`child_process`、`electron` 等);文件读写只走 Obsidian Vault API。测试文件除外。
- 编译器入口用 `inkjs/full`;`INCLUDE` 路径一律相对**主剧本所在文件夹**解析(与 inklecate / Inky 一致)。
- 界面文字全部中文;ink 关键字保持英文;未命中对照表的报错保留英文原文并附"暂无中文翻译"。
- 第一期不做存档、不做 knot 图谱;试玩只有"重新开始"。
- 触屏适配:选项按钮最小点击高度 44px;不依赖悬停。
- 提交信息末尾带仓库约定的署名行(`Co-Authored-By` 与 `Claude-Session`,见最近一次提交)。

## Review Focus

1. `INCLUDE` 行带 CRLF 换行(Windows 编辑过的文件):文件名不能带 `\r`。→ Task 2
2. `INCLUDE` 的文件名含中文或空格:能解析、能加载。→ Task 2、3
3. 空的 `.ink` 文件:编译不抛异常,返回结构完整的结果。→ Task 5
4. 连续快速编辑:先发起的旧编译结果不能覆盖后发起的新结果。→ Task 8
5. 被锁定的主剧本被删除或重命名:锁定自动清除或跟随新路径,不留悬空状态。→ Task 8

## File Structure

```
manifest.json  package.json  tsconfig.json  esbuild.config.mjs  vitest.config.ts  styles.css
src/main.ts                  插件入口:注册视图/扩展名/命令,事件接线,重新编译调度
src/i18n.ts                  全部中文界面文案(常量)
src/compile/paths.ts         路径工具 + scanIncludes
src/compile/include.ts       预加载 + CachedFileHandler
src/compile/diagnostics.ts   Diagnostic 类型、解析原始报错、翻译
src/compile/zh.ts            报错对照表
src/compile/compile.ts       compileStory
src/play/session.ts          PlaySession
src/editor/tokenize.ts       tokenizeLine
src/editor/highlight.ts      CodeMirror 高亮扩展
src/root.ts                  resolveRoot / isDependency / applyVaultEvent / LatestOnly
src/views/InkView.ts         .ink 编辑视图
src/views/PlayView.ts        试玩面板
tests/*.test.ts              与 src 模块一一对应
```

---

### Task 1: 项目脚手架

**Files:**
- Create: `package.json`、`tsconfig.json`、`esbuild.config.mjs`、`vitest.config.ts`、`manifest.json`、`styles.css`(先空)、`.gitignore`(忽略 `node_modules`、`main.js`)、`tests/smoke.test.ts`、`src/main.ts`(最小可加载的 `Plugin` 子类)

**Interfaces:**
- Produces: `npm test`(vitest run)、`npm run build`(`tsc --noEmit` 后 esbuild 打包出根目录 `main.js`)、`npm run dev`(esbuild watch;若设置环境变量 `OBSIDIAN_PLUGIN_DIR`,则 `main.js`/`manifest.json`/`styles.css` 输出到该目录)。

- [ ] **Step 1: 写冒烟测试** `tests/smoke.test.ts`:`import { Compiler } from "inkjs/full"`,断言 `typeof Compiler === "function"`。
- [ ] **Step 2: 建立配置**:esbuild 以 `src/main.ts` 为入口,格式 `cjs`,`external` 含 `obsidian`、`electron`、`@codemirror/*`、`@lezer/*`;`manifest.json` 的 `minAppVersion` 取当前 `obsidian` 包对应的稳定版本。
- [ ] **Step 3: 验证** — Run: `npm install && npm test && npm run build`;Expected: 测试通过,根目录出现 `main.js`。
- [ ] **Step 4: Commit** — `chore: scaffold ink-cn plugin`

---

### Task 2: 路径工具与 INCLUDE 扫描

**Files:**
- Create: `src/compile/paths.ts`;Test: `tests/paths.test.ts`

**Interfaces:**
- Produces:
  - `normalizePath(p: string): string` — 正斜杠,折叠 `.` 与 `..`,无前导 `/`。
  - `dirname(p: string): string` — 无目录返回 `""`。
  - `resolveInclude(rootPath: string, includeName: string): string` — `normalizePath(dirname(rootPath) + "/" + includeName)`。
  - `scanIncludes(source: string): string[]` — 返回每个 `INCLUDE` 的文件名(去掉首尾空白与 `\r`),按出现顺序,不去重。

- [ ] **Step 1: 写失败测试**
  - `resolveInclude("stories/main.ink", "ch1/a.ink")` → `"stories/ch1/a.ink"`;`resolveInclude("stories/main.ink", "../shared.ink")` → `"shared.ink"`;`resolveInclude("main.ink", "a.ink")` → `"a.ink"`。
  - `scanIncludes("INCLUDE a.ink\n  INCLUDE b.ink  \n// INCLUDE c.ink\nText")` → `["a.ink", "b.ink"]`。
  - (Review Focus 1)`scanIncludes("INCLUDE a.ink\r\nINCLUDE b.ink\r\n")` → `["a.ink", "b.ink"]`。
  - (Review Focus 2)`scanIncludes("INCLUDE 第一章 开场.ink")` → `["第一章 开场.ink"]`;`resolveInclude("故事/主.ink", "第一章 开场.ink")` → `"故事/第一章 开场.ink"`。
- [ ] **Step 2: 运行确认失败** — `npx vitest run tests/paths.test.ts`;Expected: FAIL(模块不存在)。
- [ ] **Step 3: 实现上述四个函数**。`scanIncludes` 用多行正则按行匹配,行首允许缩进。
- [ ] **Step 4: 运行确认通过**。
- [ ] **Step 5: Commit** — `feat: add path utils and INCLUDE scanner`

---

### Task 3: INCLUDE 预加载与缓存文件处理器

**Files:**
- Create: `src/compile/include.ts`;Test: `tests/include.test.ts`

**Interfaces:**
- Consumes: `resolveInclude`、`scanIncludes`(Task 2)。
- Produces:
  - `type ReadFile = (vaultPath: string) => Promise<string>`(文件不存在时应 reject)。
  - `interface FileCache { files: Map<string, string>; missing: Set<string> }`。
  - `preload(rootPath: string, readFile: ReadFile): Promise<FileCache>` — `files` 含主剧本自身;用已访问集合防止循环引用死循环;读取失败的路径进 `missing`。
  - `class CachedFileHandler implements IFileHandler`(接口来自 `inkjs/compiler/IFileHandler`),`constructor(rootPath: string, cache: FileCache)`:`ResolveInkFilename(name)` 返回 `resolveInclude(rootPath, name)`;`LoadInkFileContents(resolved)` 从缓存同步返回,缺失则 `throw new Error("Cannot open " + resolved)`。

- [ ] **Step 1: 写失败测试**(用内存 `Map` 充当 `readFile`)
  - 主剧本 `s/main.ink` 含 `INCLUDE a.ink`,`a.ink` 含 `INCLUDE sub/b.ink`:`preload` 后 `files` 的键为 `["s/main.ink","s/a.ink","s/sub/b.ink"]`。
  - 循环:`a.ink` 含 `INCLUDE main.ink`,`preload` 正常结束,`files` 大小为 2。
  - 缺失:`INCLUDE nope.ink` → `missing` 含 `"s/nope.ink"`,不抛异常。
  - (Review Focus 2)含空格、中文文件名的 `INCLUDE` 能进 `files`。
  - `new CachedFileHandler("s/main.ink", cache).LoadInkFileContents("s/a.ink")` 返回缓存内容;对缺失路径抛错。
- [ ] **Step 2: 运行确认失败**。
- [ ] **Step 3: 实现**。
- [ ] **Step 4: 运行确认通过**。
- [ ] **Step 5: Commit** — `feat: preload INCLUDE files into a cache`

---

### Task 4: 报错解析与中文翻译

**Files:**
- Create: `src/compile/diagnostics.ts`、`src/compile/zh.ts`;Test: `tests/diagnostics.test.ts`

**Interfaces:**
- Produces:
  - `type Severity = "error" | "warning" | "todo"`。
  - `interface Diagnostic { severity: Severity; file: string; line: number | null; message: string; raw: string }` — `file` 为 vault 路径(Task 5 填充),`message` 为已翻译文本。
  - `parseRaw(raw: string, fallback?: Severity): { severity: Severity; file: string | null; line: number | null; text: string }` — 识别 inkjs 的格式 `ERROR:|WARNING:|TODO: ['<file>' ][line N: ]<text>`(核对自 `inkjs` 的 `InkParser.OnStringParserError` 与 `ParsedHierarchy/Story.Error`);无前缀用 `fallback`(默认 `"error"`)。
  - `translate(text: string): string` — 命中 `zh.ts` 对照表返回中文,否则返回 `text + "(暂无中文翻译)"`。
  - `zh.ts` 导出 `zhTable: Array<[RegExp, (m: RegExpMatchArray) => string]>`。初始条目(都已在 `inkjs` 源码中核实):
    - `Recursive INCLUDE detected: '<f>' is already open.` → `检测到循环引用:'<f>' 已经在引用链中`
    - `Failed to load: '<f>'.\nError:...` → `无法加载文件:'<f>'(找不到或无法读取)`
    - `Expected closing ')'` → `缺少右括号 ')'`
    - `Empty diverts (->) are only valid on choices` → `空的跳转 (->) 只能出现在选项里`
    - `Constant strings cannot contain any logic.` → `常量字符串里不能包含逻辑`

- [ ] **Step 1: 写失败测试**
  - `parseRaw("ERROR: 'a.ink' line 3: Expected closing ')'")` → `{severity:"error", file:"a.ink", line:3, text:"Expected closing ')'"}`。
  - `parseRaw("WARNING: line 7: foo")` → `{severity:"warning", file:null, line:7, text:"foo"}`。
  - `parseRaw("TODO: line 2: fix")` → `severity:"todo"`。
  - `parseRaw("Compilation failed.")` → `{severity:"error", file:null, line:null, text:"Compilation failed."}`。
  - 对照表每个条目一个 `translate` 用例,断言完整中文;`translate("Something unknown")` → `"Something unknown(暂无中文翻译)"`。
- [ ] **Step 2: 运行确认失败**。
- [ ] **Step 3: 实现**。
- [ ] **Step 4: 运行确认通过**。
- [ ] **Step 5: Commit** — `feat: parse and translate compiler messages`

---

### Task 5: compileStory

**Files:**
- Create: `src/compile/compile.ts`;Test: `tests/compile.test.ts`

**Interfaces:**
- Consumes: `preload`、`CachedFileHandler`、`ReadFile`(Task 3);`parseRaw`、`translate`、`Diagnostic`(Task 4);`resolveInclude`(Task 2)。
- Produces:
  - `interface CompileResult { ok: boolean; story: Story | null; diagnostics: Diagnostic[]; files: string[] }` — `files` 是本次涉及的全部 vault 路径(含主剧本和缺失文件),用于判断哪些文件变动要触发重新编译。
  - `compileStory(rootPath: string, readFile: ReadFile): Promise<CompileResult>`。

要点(不是函数体):`CompilerOptions` 的 `sourceFilename` 传主剧本的**文件名(basename)**,这样 `inkjs` 能把主剧本登记为已打开文件,循环引用检测才完整;`errorHandler` 收集原始报错;`new Compiler(source, options).Compile()` 必须用 try/catch 包住(有错时它会抛 `"Compilation failed."`,该异常不再单独生成诊断,除非回调从未收到任何错误);`Diagnostic.file` 由报错里的文件名经 `resolveInclude(rootPath, name)` 得到,报错无文件名则为 `rootPath`;存在 `severity === "error"` 的诊断时 `story` 为 `null`、`ok` 为 `false`。

- [ ] **Step 1: 写失败测试**(内存 `readFile`)
  - `"Hello\n-> END"` → `ok` 为 true,`story.Continue()` 返回 `"Hello\n"`,`diagnostics` 为空,`files` 为 `[rootPath]`。
  - `"-> nowhere"` → `ok` 为 false,`story` 为 null,首个诊断 `severity` 为 `"error"`、`file` 为 `rootPath`、`line` 为 1。
  - 多文件:主剧本 `INCLUDE ch1/a.ink\n-> a`,`ch1/a.ink` 为 `=== a ===\nA text\n-> END` → `ok` 为 true,`files` 含两个路径,`Continue()` 得到 `"A text\n"`。
  - 子文件出错:`ch1/a.ink` 含 `-> nowhere` → 诊断的 `file` 为 `"s/ch1/a.ink"`(`rootPath` 为 `"s/main.ink"`)。
  - 循环引用:报错翻译为 `检测到循环引用:...`;缺失文件:报错翻译为 `无法加载文件:...`,且 `files` 含该缺失路径。
  - (Review Focus 3)空字符串源文件:不抛异常,返回含 `diagnostics`、`files` 字段的结果对象。
  - 任一诊断的 `message` 都不含 `"ERROR:"` 前缀。
- [ ] **Step 2: 运行确认失败**。
- [ ] **Step 3: 实现 `compileStory`**。
- [ ] **Step 4: 运行确认通过**。
- [ ] **Step 5: Commit** — `feat: compile ink stories with INCLUDE support`

---

### Task 6: 试玩会话 PlaySession

**Files:**
- Create: `src/play/session.ts`;Test: `tests/session.test.ts`

**Interfaces:**
- Consumes: 编译得到的 `Story`(Task 5)。
- Produces:
  - `interface Paragraph { text: string; tags: string[] }`、`interface Choice { index: number; text: string }`
  - `interface Step { paragraphs: Paragraph[]; choices: Choice[]; ended: boolean; errors: string[] }`
  - `class PlaySession { constructor(story: Story); start(): Step; choose(index: number): Step; restart(): Step }` — `paragraphs` 是该步新增的段落(文本去掉末尾换行);`ended` 在既无选项又不能继续时为 true;`errors` 收集运行时错误(通过 `story.onError`);`restart()` 调用 `story.ResetState()` 后等同 `start()`。

- [ ] **Step 1: 写失败测试**(用 Task 5 的 `compileStory` 编出的故事 `"Hello\n* [Go] Went\n  -> END"`)
  - `start()` → `paragraphs` 文本为 `["Hello"]`,`choices` 为 `[{index:0,text:"Go"}]`,`ended` 为 false。
  - `choose(0)` → `paragraphs` 文本为 `["Went"]`,`choices` 为空,`ended` 为 true。
  - `restart()` 之后返回值与第一次 `start()` 相同。
  - 带标签的故事 `"Line #mood:sad\n-> END"` → `paragraphs[0].tags` 为 `["mood:sad"]`。
- [ ] **Step 2: 运行确认失败**。
- [ ] **Step 3: 实现**。
- [ ] **Step 4: 运行确认通过**。
- [ ] **Step 5: Commit** — `feat: add play session over compiled stories`

---

### Task 7: 语法高亮(分词 + CodeMirror 扩展)

**Files:**
- Create: `src/editor/tokenize.ts`、`src/editor/highlight.ts`;Modify: `styles.css`;Test: `tests/tokenize.test.ts`

**Interfaces:**
- Produces:
  - `type TokenKind = "knot" | "stitch" | "choice" | "gather" | "divert" | "logic" | "keyword" | "comment" | "tag"`、`interface Token { from: number; to: number; kind: TokenKind }`
  - `tokenizeLine(line: string): Token[]` — 互不重叠、按 `from` 升序;未着色的普通文本不产生 token。
  - `inkHighlight: Extension`(`highlight.ts`)— CodeMirror 6 `ViewPlugin`,对可见行调用 `tokenizeLine`,为每个 token 加 `Decoration.mark({ class: "ink-tok-" + kind })`。`styles.css` 为每种 `kind` 提供颜色,使用 Obsidian 的 CSS 变量以兼容亮/暗主题。

- [ ] **Step 1: 写失败测试**(`tokenizeLine`,from/to 为精确值)
  - `"=== 第一章 ==="` → `[{from:0,to:11,kind:"knot"}]`;`"= 小节"` → 整行 `stitch`。
  - `"// hi"` → `[{from:0,to:5,kind:"comment"}]`;`"text // note"` → `[{from:5,to:12,kind:"comment"}]`。
  - `"* [Go] text -> next"` → `[{from:0,to:1,kind:"choice"},{from:12,to:19,kind:"divert"}]`。
  - `"VAR hp = 3"` → `[{from:0,to:3,kind:"keyword"}]`;`INCLUDE`、`CONST`、`LIST`、`EXTERNAL` 同理。
  - `"~ hp = hp - 1"` → `[{from:0,to:13,kind:"logic"}]`。
  - `"plain text #tag"` → `[{from:11,to:15,kind:"tag"}]`。
  - `""` → `[]`。
- [ ] **Step 2: 运行确认失败**。
- [ ] **Step 3: 实现 `tokenizeLine`**(`//` 注释优先于其它规则;不要把 `->` 误判成 gather 的 `-`)。
- [ ] **Step 4: 实现 `inkHighlight` 与 `styles.css`**(无自动化测试,Task 9 手动验证)。
- [ ] **Step 5: 运行确认通过 + `npm run build` 通过**。
- [ ] **Step 6: Commit** — `feat: add ink syntax highlighting`

---

### Task 8: 主剧本规则与重新编译调度

**Files:**
- Create: `src/root.ts`;Test: `tests/root.test.ts`

**Interfaces:**
- Produces:
  - `resolveRoot(activePath: string | null, locked: string | null): string | null` — 有锁定返回锁定路径;否则当前文件是 `.ink` 才返回它,其余 `null`。
  - `isDependency(changedPath: string, files: string[]): boolean`。
  - `type VaultEvent = { type: "delete"; path: string } | { type: "rename"; path: string; newPath: string }`;`applyVaultEvent(locked: string | null, ev: VaultEvent): string | null` — 删除的是锁定文件则返回 `null`,重命名的是锁定文件则返回 `newPath`,其余原样返回。
  - `class LatestOnly { run<T>(fn: () => Promise<T>): Promise<T | null> }` — 若在 `fn` 完成前又调用了新的 `run`,旧调用返回 `null`(结果作废)。

- [ ] **Step 1: 写失败测试**
  - `resolveRoot("a.ink", null)` → `"a.ink"`;`resolveRoot("a.md", null)` → `null`;`resolveRoot("sub.ink", "main.ink")` → `"main.ink"`;`resolveRoot(null, null)` → `null`。
  - `isDependency("a.ink", ["main.ink","a.ink"])` 为 true,`"x.ink"` 为 false。
  - (Review Focus 5)`applyVaultEvent("main.ink", {type:"delete", path:"main.ink"})` → `null`;重命名 → `newPath`;无关文件的事件 → `"main.ink"`。
  - (Review Focus 4)`LatestOnly`:先后发起两个 `run`(第一个耗时更长),第一个返回 `null`,第二个返回其结果。
- [ ] **Step 2: 运行确认失败**。
- [ ] **Step 3: 实现**。
- [ ] **Step 4: 运行确认通过**。
- [ ] **Step 5: Commit** — `feat: add main-story locking rules and latest-wins runner`

---

### Task 9: 编辑视图与 `.ink` 文件注册

**Files:**
- Create: `src/views/InkView.ts`、`src/i18n.ts`;Modify: `src/main.ts`

**Interfaces:**
- Consumes: `inkHighlight`(Task 7)。
- Produces:
  - `const INK_VIEW_TYPE = "ink-cn-editor"`;`class InkView extends TextFileView`,内含一个独立的 CodeMirror `EditorView`(扩展:`history()`、`keymap.of([...defaultKeymap, ...historyKeymap])`、`EditorView.lineWrapping`、`inkHighlight`,文档变更时调用 `requestSave()`);实现 `getViewData()/setViewData()/clear()`;提供 `goToLine(line: number): void`(滚动并选中该行)。
  - `i18n.ts` 导出中文文案常量对象 `T`(本任务先放视图名,后续任务补充)。
  - `main.ts` 的 `onload` 中 `registerView(INK_VIEW_TYPE, …)` 并 `registerExtensions(["ink"], INK_VIEW_TYPE)`。

- [ ] **Step 1: 实现上述内容**。
- [ ] **Step 2: 构建** — `npm run build`;Expected: 通过。
- [ ] **Step 3: 手动验证(桌面)**:用 `OBSIDIAN_PLUGIN_DIR` 指向测试 vault 的 `.obsidian/plugins/ink-cn`,`npm run dev`,在 Obsidian 启用插件,新建 `test.ink`,确认:能打开编辑;中文输入正常;`==`/`*`/`->`/`//` 等有颜色;撤销重做可用;修改后保存到文件(用别的编辑器打开核对)。
- [ ] **Step 4: Commit** — `feat: register .ink files with an editor view`

---

### Task 10: 试玩面板与重新编译接线

**Files:**
- Create: `src/views/PlayView.ts`;Modify: `src/main.ts`、`src/i18n.ts`、`styles.css`

**Interfaces:**
- Consumes: `compileStory`、`CompileResult`(Task 5);`PlaySession`、`Step`(Task 6);`resolveRoot`、`isDependency`、`applyVaultEvent`、`LatestOnly`(Task 8);`InkView.goToLine`(Task 9)。
- Produces:
  - `const PLAY_VIEW_TYPE = "ink-cn-play"`;`class PlayView extends ItemView`,公开 `showResult(root: string | null, result: CompileResult | null, locked: string | null): void`。面板内容:顶部显示当前主剧本名与"重新开始"、"锁定为主剧本 / 解除锁定"按钮;中部按段落渲染故事文本;选项为整行大按钮(最小高度 44px);底部是诊断列表(点击某条诊断,打开对应文件并 `goToLine`)。有 `error` 诊断时不显示故事,只显示诊断。
  - `main.ts`:持久化设置 `{ locked: string | null }`(`loadData/saveData`);命令"打开试玩面板"(同时加 ribbon 图标)、"将当前文件锁定为主剧本"、"解除主剧本锁定";事件接线:`active-leaf-change` 与 `vault` 的 `modify`(仅当 `isDependency` 为真)触发重新编译,编译包在 `LatestOnly` 里并做 300ms 防抖;`vault` 的 `delete`/`rename` 经 `applyVaultEvent` 更新锁定;`readFile` 用 `vault.getAbstractFileByPath` 取 `TFile` 后 `vault.cachedRead`,路径不是文件时 reject;每次编译成功后用新 `Story` 创建新的 `PlaySession`(重新编译即重新开始)。

- [ ] **Step 1: 实现上述内容**。
- [ ] **Step 2: 构建** — `npm run build`;Expected: 通过;`npm test` 全部通过。
- [ ] **Step 3: 手动验证(桌面)**:
  1. 单文件剧本:能玩到结局,"重新开始"回到开头。
  2. 故意写错(如 `-> nowhere`):面板显示中文报错和行号,点击报错跳到该行。
  3. 多文件:`main.ink` 含 `INCLUDE ch1/a.ink`,改 `a.ink` 并保存后面板自动更新;`a.ink` 里写错,报错指向 `a.ink` 的对应行。
  4. 锁定:锁定 `main.ink` 后切到 `a.ink` 编辑,面板仍运行 `main.ink`;删除或重命名 `main.ink` 后锁定自动清除/跟随。
  5. 注意:`TextFileView` 的保存是防抖的,编辑后约 2 秒才触发重新编译,属预期。
- [ ] **Step 4: Commit** — `feat: add play panel and live recompilation`

---

### Task 11: 手机端验证与文档

**Files:**
- Create: `README.md`、`docs/verification-mobile.md`

- [ ] **Step 1: 写 `README.md`**:插件做什么、构建命令、如何把 `main.js`/`manifest.json`/`styles.css` 放进 vault 的 `.obsidian/plugins/ink-cn/`、`INCLUDE` 与主剧本锁定的用法。
- [ ] **Step 2: 记录体积** — Run: `npm run build && ls -l main.js`;把大小写入 `docs/verification-mobile.md`。
- [ ] **Step 3: 手机端逐项验证并记录结果**(把插件文件同步到手机的 vault 后):
  - 插件能启用,无报错。
  - 设计文档 §9 的三项假设:编译器能在手机上运行且速度可接受(记录编译一个约 200 行剧本的主观耗时);`.ink` 编辑视图的输入、选择、撤销在触屏下可用;中文输入法输入正常。
  - 试玩面板:选项好点、不误触;诊断点击能跳转。
- [ ] **Step 4: 若任一假设不成立**:停止,在 `docs/verification-mobile.md` 写明现象,并向用户报告,由用户决定调整方案(例如换编辑方式)。
- [ ] **Step 5: Commit** — `docs: add README and mobile verification notes`
