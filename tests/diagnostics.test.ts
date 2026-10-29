import { describe, expect, test } from "vitest";
import { parseRaw, translate } from "../src/compile/diagnostics";

describe("parseRaw", () => {
  test("error with file and line", () => {
    expect(parseRaw("ERROR: 'a.ink' line 3: Expected closing ')'")).toEqual({
      severity: "error", file: "a.ink", line: 3, text: "Expected closing ')'",
    });
  });
  test("warning with line only", () => {
    expect(parseRaw("WARNING: line 7: foo")).toEqual({ severity: "warning", file: null, line: 7, text: "foo" });
  });
  test("todo", () => {
    expect(parseRaw("TODO: line 2: fix").severity).toBe("todo");
  });
  test("message without prefix uses the fallback severity", () => {
    expect(parseRaw("Compilation failed.")).toEqual({
      severity: "error", file: null, line: null, text: "Compilation failed.",
    });
  });
});

describe("translate", () => {
  test.each([
    ["Recursive INCLUDE detected: 'a.ink' is already open.", "检测到循环引用:'a.ink' 已经在引用链中"],
    ["Failed to load: 'a.ink'.\nError:Error: Cannot open s/a.ink", "无法加载文件:'a.ink'(找不到或无法读取)"],
    ["Expected closing ')'", "缺少右括号 ')'"],
    ["Empty diverts (->) are only valid on choices", "空的跳转 (->) 只能出现在选项里"],
    ["Constant strings cannot contain any logic.", "常量字符串里不能包含逻辑"],
    ["Divert target not found: '-> nowhere'", "找不到跳转目标 '-> nowhere',检查 knot 或 stitch 的名字是否拼错"],
    ["Unresolved variable: x", "找不到名称 'x':变量需要先用 VAR 声明,或检查拼写"],
    ["Variable could not be found to assign to: 'x'", "无法给 'x' 赋值:它还没有声明(全局变量用 VAR,临时变量用 ~ temp)"],
    ["Expected initial value for  but saw end of line", "缺少初始值:VAR / CONST 必须给出一个常量初始值(实际是:行尾)"],
    ["Expected initial value for  but saw '{1}'", "缺少初始值:VAR / CONST 必须给出一个常量初始值(实际是:'{1}')"],
    ["found declaration variable 'x' that was already declared (line 1 of main.ink\")", "变量 'x' 重复声明(之前已在 main.ink 第 1 行声明)"],
    ["Story already contains flow named 'a' (at line 2 of main.ink\")", "名字 'a' 已被另一个 knot 或函数使用(main.ink 第 2 行),名字不能重复"],
    ["Expected closing ']' for weave-style option but saw end of line", "选项缺少右方括号 ']'(实际是:行尾)"],
    ["Expected some kind of logic, conditional or sequence within braces: { ... } but saw 'x'", "花括号 { } 里应该是逻辑、条件或序列(实际是:'x')"],
    ["Expected closing brace '}' for inline logic but saw end of line", "缺少右花括号 '}'(实际是:行尾)"],
    ["Function call target not found: '-> f'", "找不到被调用的函数 'f'"],
    ["Function call to 'f' requires 1 arguments, but got 2", "函数 'f' 需要 1 个参数,但传入了 2 个"],
    ["should not have return statement outside of a knot", "return 只能写在函数里"],
    ["Functions may not contain diverts, but saw '-> END'", "函数里不能有跳转,但出现了 '-> END'"],
    ["Expected end of line but saw '}'", "这一行应该结束了,但多出了:'}'"],
    ["Expected the name of the knot", "缺少 knot 的名字"],
    ["Expected the name of the function", "缺少函数的名字"],
    ["Expected variable name but saw '= 1'", "缺少变量名(实际是:'= 1')"],
    ["Choice is completely empty. Interpretting as a default fallback choice. Add a divert arrow to remove this warning: * ->", "选项内容为空,会被当作默认兜底选项;如果是有意的,写成 * -> 可消除此警告"],
    ["Error: Missing function binding for external: 'f'  (ink fallbacks disabled)", "外部函数 'f' 没有绑定:请写一个同名的 ink 函数作为替代"],
    ["Error: Missing function binding for external: 'f' , and no fallback ink function found.", "外部函数 'f' 没有绑定:请写一个同名的 ink 函数作为替代"],
    ["Error: Missing function binding for externals: 'f', 'g' , and no fallback ink function found.", "外部函数 'f', 'g' 没有绑定:请写一个同名的 ink 函数作为替代"],
    ["Expected weave point but saw 'x'", "期望 weave point,但实际是:'x'"],
  ])("%s", (en, zh) => {
    expect(translate(en)).toBe(zh);
  });
  test("unknown messages keep the original and get a hint", () => {
    expect(translate("Something unknown")).toBe("Something unknown(暂无中文翻译)");
  });
});
