export const zhTable: Array<[RegExp, (m: RegExpMatchArray) => string]> = [
  [/^Recursive INCLUDE detected: '(.+)' is already open\.$/, (m) => `检测到循环引用:'${m[1]}' 已经在引用链中`],
  [/^Failed to load: '(.+?)'\.\nError:[\s\S]*$/, (m) => `无法加载文件:'${m[1]}'(找不到或无法读取)`],
  [/^Expected closing '\)'$/, () => "缺少右括号 ')'"],
  [/^Empty diverts \(->\) are only valid on choices$/, () => "空的跳转 (->) 只能出现在选项里"],
  [/^Constant strings cannot contain any logic\.$/, () => "常量字符串里不能包含逻辑"],
];
