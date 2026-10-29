// Each pattern matches an exact message text produced by inkjs (verified by
// compiling broken stories), without the "ERROR: 'file' line N:" prefix.

/** Turns inkjs's "but saw ..." fragment into Chinese. */
function saw(text: string): string {
  return text === "end of line" ? "行尾" : text;
}

export const zhTable: Array<[RegExp, (m: RegExpMatchArray) => string]> = [
  [/^Recursive INCLUDE detected: '(.+)' is already open\.$/, (m) => `检测到循环引用:'${m[1]}' 已经在引用链中`],
  [/^Failed to load: '(.+?)'\.\nError:[\s\S]*$/, (m) => `无法加载文件:'${m[1]}'(找不到或无法读取)`],
  [/^Expected closing '\)'$/, () => "缺少右括号 ')'"],
  [/^Empty diverts \(->\) are only valid on choices$/, () => "空的跳转 (->) 只能出现在选项里"],
  [/^Constant strings cannot contain any logic\.$/, () => "常量字符串里不能包含逻辑"],
  [/^Divert target not found: '(.+)'$/, (m) => `找不到跳转目标 '${m[1]}',检查 knot 或 stitch 的名字是否拼错`],
  [/^Unresolved variable: (.+)$/, (m) => `找不到名称 '${m[1]}':变量需要先用 VAR 声明,或检查拼写`],
  [/^Variable could not be found to assign to: '(.+)'$/, (m) => `无法给 '${m[1]}' 赋值:它还没有声明(全局变量用 VAR,临时变量用 ~ temp)`],
  [/^Expected initial value for .* but saw (.+)$/, (m) => `缺少初始值:VAR / CONST 必须给出一个常量初始值(实际是:${saw(m[1])})`],
  [/^found declaration variable '(.+)' that was already declared \(line (\d+) of ([^"]+)"?\)$/, (m) => `变量 '${m[1]}' 重复声明(之前已在 ${m[3]} 第 ${m[2]} 行声明)`],
  [/^Story already contains flow named '(.+)' \(at line (\d+) of ([^"]+)"?\)$/, (m) => `名字 '${m[1]}' 已被另一个 knot 或函数使用(${m[3]} 第 ${m[2]} 行),名字不能重复`],
  [/^Expected closing '\]' for weave-style option but saw (.+)$/, (m) => `选项缺少右方括号 ']'(实际是:${saw(m[1])})`],
  [/^Expected some kind of logic, conditional or sequence within braces: \{ \.\.\. \} but saw (.+)$/, (m) => `花括号 { } 里应该是逻辑、条件或序列(实际是:${saw(m[1])})`],
  [/^Expected closing brace '\}' for inline logic but saw (.+)$/, (m) => `缺少右花括号 '}'(实际是:${saw(m[1])})`],
  [/^Function call target not found: '-> (.+)'$/, (m) => `找不到被调用的函数 '${m[1]}'`],
  [/^Function call to '(.+)' requires (\d+) arguments?, but got (\d+)$/, (m) => `函数 '${m[1]}' 需要 ${m[2]} 个参数,但传入了 ${m[3]} 个`],
  [/^should not have return statement outside of a knot$/, () => "return 只能写在函数里"],
  [/^Functions may not contain diverts, but saw '(.+)'$/, (m) => `函数里不能有跳转,但出现了 '${m[1]}'`],
  [/^Expected end of line but saw (.+)$/, (m) => `这一行应该结束了,但多出了:${m[1]}`],
  [/^Expected the name of the knot$/, () => "缺少 knot 的名字"],
  [/^Expected the name of the function$/, () => "缺少函数的名字"],
  [/^Expected variable name but saw (.+)$/, (m) => `缺少变量名(实际是:${saw(m[1])})`],
  [/^Choice is completely empty\. Interpretting as a default fallback choice\./, () => "选项内容为空,会被当作默认兜底选项;如果是有意的,写成 * -> 可消除此警告"],
  [/^(?:Error: )?Missing function binding for externals?: '(.+)'\s+(?:,|\()/, (m) => `外部函数 '${m[1]}' 没有绑定:请写一个同名的 ink 函数作为替代`],
  [/^Apparent loose end exists where the flow runs out\./, () => "故事在这里断头了:流程走到尽头却没有出口,需要加 -> DONE、-> END、选项或跳转"],
  [/^ran out of content\./, () => "内容播完了,但故事没有结束:需要加 -> DONE 或 -> END"],
  [/^Found tunnel onwards statement \(->->\), when expected end of flow/, () => "出现了隧道返回 ->->,但当前并不在隧道里(这里应该是 -> END 或选项)"],
  [/^unexpectedly reached end of content\. Do you need a '->->' to return from a tunnel\?/, () => "意外走到了内容结尾:隧道末尾是不是忘了写 ->-> 返回?"],
  [/^global variable assignments cannot refer to other variables/, () => "全局变量的初始值不能引用别的变量,只能是字面值、常量(CONST)或 LIST 项"],
  [/^initial value for a variable must be a number, constant, list or divert target$/, () => "变量的初始值必须是数字、常量、LIST 项或跳转目标,不能写算式"],
  [/^Functions may not contain choices, but saw /, () => "函数里不能有选项(* 或 +)"],
  [/^Return statements can only be used in knots that are declared as functions: (.+)$/, (m) => `return 只能用在函数里,请把这个 knot 声明成函数:${m[1]}`],
  [/^RANDOM was called with minimum as (-?\d+) and maximum as (-?\d+)\. The maximum must be larger/, (m) => `RANDOM 的最小值是 ${m[1]}、最大值是 ${m[2]}:最大值必须比最小值大`],
  [/^RANDOM should take 2 parameters: a minimum and a maximum integer$/, () => "RANDOM 需要 2 个参数:最小值和最大值(整数)"],
  [/^Expected the '=' for an assignment of a value, e\.g\. '= 5' \(initial values are mandatory\) but saw (.+)$/, (m) => `缺少 '=' 和初始值:声明变量必须给初始值,例如 VAR 金币 = 5(实际是:${saw(m[1])})`],
  [/^Expected closing parenthesis '\)' for expression but saw (.+)$/, (m) => `表达式缺少右括号 ')'(实际是:${saw(m[1])})`],
  // Generic parser expectation; keep last so the specific entries above win.
  [/^Expected (.+?) but saw (.+)$/, (m) => `期望 ${m[1]},但实际是:${saw(m[2])}`],
];
