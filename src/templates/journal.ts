/**
 * The journal game template (solo PRD §4.10): each day a prompt from a table, a paragraph written, the dice tray
 * for questions, a clock for the road, two records, and a live journal note. Original text, one language per
 * copy (the interface's). Pure data: the plugin writes the files and generates the engine from `game.md`.
 */

export interface TemplateFiles {
  /** File name (relative to the new folder) → contents. `_engine.ink` is not here: it is generated from game.md. */
  files: Record<string, string>;
  /** The note the story links to, opened next to the story. */
  guide: string;
}

const ZH_PROMPTS = [
  "路边有人在等一辆不会来的车。你们说了什么?",
  "你在一座空房子里过夜。屋里留着什么?",
  "天气突然变了。你躲在哪里,等了多久?",
  "你丢了一样东西。是什么?还找得回来吗?",
  "有人给了你一样东西,只要你答应一件事。",
  "你远远看见了终点,走近一看却不是。",
  "你梦见了出发的地方。那里变了什么?",
  "一封信追上了你。信里写了什么?",
];

const EN_PROMPTS = [
  "Someone by the road waits for a bus that will not come. What do you talk about?",
  "You spend the night in an empty house. What was left in it?",
  "The weather turns. Where do you shelter, and for how long?",
  "You lose something. What is it, and can you get it back?",
  "Someone gives you a thing, if you promise them one.",
  "You see the end of the road from far off; up close it is somewhere else.",
  "You dream of the place you set out from. What has changed there?",
  "A letter catches up with you. What does it say?",
];

/** YAML-safe quoting for a line of text. */
const q = (s: string) => JSON.stringify(s);

export function journalTemplate(lang: "zh" | "en", title: string): TemplateFiles {
  return lang === "zh" ? zh(title) : en(title);
}

function zh(title: string): TemplateFiles {
  const guide = "旅途说明";
  return {
    guide,
    files: {
      "game.md": `---
rules: { kind: sum, dice: [6, 6] }
skills:
  - { id: heart, name: 心 }
characters:
  - { id: you, name: 旅人, skills: { heart: 1 } }
resources:
  - { id: road, name: 路程, min: 0, max: 6, initial: 0, display: clock, manual: true }
records:
  - { id: people, name: 遇见的人 }
  - { id: notes, name: 记住的事 }
tables:
  - id: prompt
    name: 今日
    oracle: true
    rows:
${ZH_PROMPTS.map((p) => `      - { text: ${q(p)} }`).join("\n")}
journal: { live: true, path: "{dir}日志/{date} {time}.md" }
---

# ${title}

日志型单人游戏。规则在上面的 frontmatter 里,剧本是同一个文件夹的 \`main.ink\`,玩法和改法见 [[${guide}]]。
`,
      "main.ink": `// ${title}:日志型单人游戏。每天从「今日」表里抽一个提示,写一段;路程走满就到了。
// 改提示:game.md 的 tables;改天数:game.md 里 road 的 max(这里的 6 也要跟着改)。
// 改了 game.md 以后用命令「生成游戏引擎 ink」重新生成 _engine.ink。
INCLUDE _engine.ink
VAR entry = ""
VAR day = 0

你要去一个很远的地方。这一路上发生的事,你都想记下来。
拿不准的时候,打开下面的骰盘问一问神谕。怎么玩、怎么改,见[[${guide}]]。
~ record_add("notes", "出发的那天")
-> morning

=== morning ===
{ road >= 6: -> arrive }
~ day += 1
~ temp prompt = table("prompt")
第 {day} 天。{prompt}
+ [写下来 #write:entry]
    {entry}
    -> evening
+ [今天不写]
    你只是赶路。
    -> evening

=== evening ===
~ road += 1
{ road < 6: 天黑了。你离终点又近了一些。}
-> morning

=== arrive ===
第 {day} 天傍晚,你到了。这一路写下的东西都在日志里。
-> END
`,
      [`${guide}.md`]: `# ${guide}

这是一个日志型单人游戏的模板:每天抽一个提示,写一段,边玩边记进日志笔记。

## 怎么玩

- 打开 \`main.ink\`,在右边的试玩面板里玩。
- 选「写下来」会出现一个输入框:写一段,按 Ctrl/Cmd+回车 交出去。
- 拿不准的事,打开面板下方的**骰盘**:问神谕(是/否)、掷骰子,或者再抽一次「今日」。
- 状态栏里的**路程**是一个时钟,每天走一格,走满就到了。你也可以点 −/+ 或者点数值直接改。
- **遇见的人**和**记住的事**是两张记录,在状态栏里随手添加、划掉。
- 第一次选择后,同一个文件夹的 \`日志/\` 里会出现一篇日志笔记,之后每一步都追加进去。

## 怎么改

- 提示:\`game.md\` 的 \`tables\` 里那一行,加几条、换几条都行。
- 天数:\`game.md\` 里 \`road\` 的 \`max\`,和 \`main.ink\` 里的 6 一起改。
- 改了 \`game.md\` 以后,运行命令「生成游戏引擎 ink」重新生成 \`_engine.ink\`。
- 正文里写 \`[[笔记]]\` 就是一个链接,点开就是那篇笔记,可以把人物、地点写成设定笔记。
`,
    },
  };
}

function en(title: string): TemplateFiles {
  const guide = "How to play";
  return {
    guide,
    files: {
      "game.md": `---
rules: { kind: sum, dice: [6, 6] }
skills:
  - { id: heart, name: Heart }
characters:
  - { id: you, name: The traveller, skills: { heart: 1 } }
resources:
  - { id: road, name: The road, min: 0, max: 6, initial: 0, display: clock, manual: true }
records:
  - { id: people, name: People met }
  - { id: notes, name: Things remembered }
tables:
  - id: prompt
    name: Today
    oracle: true
    rows:
${EN_PROMPTS.map((p) => `      - { text: ${q(p)} }`).join("\n")}
journal: { live: true, path: "{dir}Journal/{date} {time}.md" }
---

# ${title}

A solo journal game. The rules are the frontmatter above, the story is \`main.ink\` in this folder; see [[${guide}]] for how to play and change it.
`,
      "main.ink": `// ${title}: a solo journal game. Each day a prompt from the "Today" table, a paragraph written; when the road is done, you are there.
// Prompts: the tables in game.md. Length: the max of road in game.md (and the 6 here).
// After changing game.md, run the command "Generate game engine ink" to write _engine.ink again.
INCLUDE _engine.ink
VAR entry = ""
VAR day = 0

You are going somewhere far away. You want to write down what happens on the way.
When you are not sure, open the dice tray below and ask the oracle. See [[${guide}]] for how to play and change it.
~ record_add("notes", "The day you set out")
-> morning

=== morning ===
{ road >= 6: -> arrive }
~ day += 1
~ temp prompt = table("prompt")
Day {day}. {prompt}
+ [Write it down #write:entry]
    {entry}
    -> evening
+ [Not today]
    You just keep walking.
    -> evening

=== evening ===
~ road += 1
{ road < 6: Night falls. You are a little closer.}
-> morning

=== arrive ===
On the evening of day {day} you arrive. What you wrote on the way is in the journal.
-> END
`,
      [`${guide}.md`]: `# ${guide}

A template for a solo journal game: a prompt each day, a paragraph written, everything kept in a journal note as you play.

## Playing

- Open \`main.ink\` and play it in the panel on the right.
- "Write it down" opens a box: write a paragraph and press Ctrl/Cmd+Enter.
- When you are not sure of something, open the **dice tray** under the choices: ask the oracle (yes/no), roll dice, or draw from "Today" again.
- **The road** on the status bar is a clock: one slice a day, and you arrive when it is full. Click −/+ or its value to change it.
- **People met** and **Things remembered** are records: add and strike out entries on the status bar.
- After the first choice a journal note appears in \`Journal/\` in this folder; every step is added to it.

## Changing it

- Prompts: the row in \`tables\` in \`game.md\`; add or replace as many as you like.
- Length: the \`max\` of \`road\` in \`game.md\`, together with the 6 in \`main.ink\`.
- After changing \`game.md\`, run the command "Generate game engine ink" to write \`_engine.ink\` again.
- \`[[a note]]\` in the text is a link: write people and places as notes of their own.
`,
    },
  };
}
