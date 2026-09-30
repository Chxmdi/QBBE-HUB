import { FormulaError } from "./errors";

/**
 * The formula language (V1-8), parsed without eval: a small hand-written
 * tokenizer and recursive-descent parser produce a tree the evaluator walks.
 *
 *   42  3.5  "text"  true  false  null
 *   prop("Due")                    a property of the object, by key or name
 *   + - * / %   == != < <= > >=   and or not   (&& || ! also accepted)
 *   if(cond, then, else)  and every function in ./functions.ts
 */
export type FormulaNode =
  | { type: "number"; value: number }
  | { type: "string"; value: string }
  | { type: "boolean"; value: boolean }
  | { type: "null" }
  | { type: "property"; name: string }
  | { type: "unary"; operator: "-" | "not"; operand: FormulaNode }
  | { type: "binary"; operator: BinaryOperator; left: FormulaNode; right: FormulaNode }
  | { type: "call"; name: string; args: FormulaNode[] };

export type BinaryOperator = "+" | "-" | "*" | "/" | "%" | "==" | "!=" | "<" | "<=" | ">" | ">=" | "and" | "or";

export const MAX_FORMULA_LENGTH = 2000;
const MAX_DEPTH = 48;

type Token =
  | { kind: "number"; value: number; position: number }
  | { kind: "string"; value: string; position: number }
  | { kind: "name"; value: string; position: number }
  | { kind: "op"; value: string; position: number }
  | { kind: "end"; position: number };

const OPERATORS = ["==", "!=", "<=", ">=", "&&", "||", "+", "-", "*", "/", "%", "<", ">", "!", "(", ")", ","];

export function tokenize(source: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  while (i < source.length) {
    const char = source[i];
    if (/\s/.test(char)) {
      i += 1;
      continue;
    }
    if (/[0-9]/.test(char) || (char === "." && /[0-9]/.test(source[i + 1] ?? ""))) {
      const match = /^(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/.exec(source.slice(i));
      if (!match) throw new FormulaError("unexpected_character", { char, position: i + 1 });
      tokens.push({ kind: "number", value: Number(match[0]), position: i + 1 });
      i += match[0].length;
      continue;
    }
    if (char === '"' || char === "'") {
      const start = i;
      let value = "";
      i += 1;
      while (i < source.length && source[i] !== char) {
        if (source[i] === "\\" && i + 1 < source.length) {
          const next = source[i + 1];
          value += next === "n" ? "\n" : next === "t" ? "\t" : next;
          i += 2;
        } else {
          value += source[i];
          i += 1;
        }
      }
      if (i >= source.length) throw new FormulaError("unterminated_string", { position: start + 1 });
      i += 1;
      tokens.push({ kind: "string", value, position: start + 1 });
      continue;
    }
    if (/[A-Za-z_À-ſ]/.test(char)) {
      const match = /^[A-Za-z_À-ſ][A-Za-z0-9_À-ſ]*/.exec(source.slice(i))!;
      tokens.push({ kind: "name", value: match[0], position: i + 1 });
      i += match[0].length;
      continue;
    }
    const operator = OPERATORS.find((candidate) => source.startsWith(candidate, i));
    if (!operator) throw new FormulaError("unexpected_character", { char, position: i + 1 });
    tokens.push({ kind: "op", value: operator, position: i + 1 });
    i += operator.length;
  }
  tokens.push({ kind: "end", position: source.length + 1 });
  return tokens;
}

const describe = (token: Token) => (token.kind === "end" ? "" : String(token.value));

/** Parses a formula, or throws a FormulaError naming where it went wrong. */
export function parseFormula(source: string): FormulaNode {
  if (source.length > MAX_FORMULA_LENGTH) throw new FormulaError("too_long", { max: MAX_FORMULA_LENGTH });
  const tokens = tokenize(source);
  let index = 0;
  let depth = 0;

  const peek = () => tokens[index];
  const next = () => tokens[index++];
  const isOp = (value: string) => {
    const token = peek();
    return token.kind === "op" && token.value === value;
  };
  const isWord = (value: string) => {
    const token = peek();
    return token.kind === "name" && token.value.toLowerCase() === value;
  };
  const expectOp = (value: string) => {
    const token = next();
    if (token.kind === "end") throw new FormulaError("unexpected_end");
    if (token.kind !== "op" || token.value !== value) {
      throw new FormulaError("unexpected_token", { token: describe(token), position: token.position });
    }
  };
  const enter = () => {
    depth += 1;
    if (depth > MAX_DEPTH) throw new FormulaError("too_deep");
  };

  function or(): FormulaNode {
    let left = and();
    while (isOp("||") || isWord("or")) {
      next();
      left = { type: "binary", operator: "or", left, right: and() };
    }
    return left;
  }
  function and(): FormulaNode {
    let left = equality();
    while (isOp("&&") || isWord("and")) {
      next();
      left = { type: "binary", operator: "and", left, right: equality() };
    }
    return left;
  }
  function equality(): FormulaNode {
    let left = comparison();
    while (isOp("==") || isOp("!=")) {
      const operator = next() as { value: "==" | "!=" };
      left = { type: "binary", operator: operator.value, left, right: comparison() };
    }
    return left;
  }
  function comparison(): FormulaNode {
    let left = additive();
    while (isOp("<") || isOp("<=") || isOp(">") || isOp(">=")) {
      const operator = next() as { value: "<" | "<=" | ">" | ">=" };
      left = { type: "binary", operator: operator.value, left, right: additive() };
    }
    return left;
  }
  function additive(): FormulaNode {
    let left = multiplicative();
    while (isOp("+") || isOp("-")) {
      const operator = next() as { value: "+" | "-" };
      left = { type: "binary", operator: operator.value, left, right: multiplicative() };
    }
    return left;
  }
  function multiplicative(): FormulaNode {
    let left = unary();
    while (isOp("*") || isOp("/") || isOp("%")) {
      const operator = next() as { value: "*" | "/" | "%" };
      left = { type: "binary", operator: operator.value, left, right: unary() };
    }
    return left;
  }
  function unary(): FormulaNode {
    if (isOp("-") || isOp("!") || isWord("not")) {
      const token = next();
      enter();
      const operand = unary();
      depth -= 1;
      return { type: "unary", operator: token.kind === "op" && token.value === "-" ? "-" : "not", operand };
    }
    return primary();
  }
  function primary(): FormulaNode {
    const token = next();
    switch (token.kind) {
      case "end":
        throw new FormulaError("unexpected_end");
      case "number":
        return { type: "number", value: token.value };
      case "string":
        return { type: "string", value: token.value };
      case "op":
        if (token.value === "(") {
          enter();
          const inner = or();
          expectOp(")");
          depth -= 1;
          return inner;
        }
        throw new FormulaError("unexpected_token", { token: token.value, position: token.position });
      case "name": {
        const word = token.value.toLowerCase();
        if (!isOp("(")) {
          if (word === "true" || word === "vrai") return { type: "boolean", value: true };
          if (word === "false" || word === "faux") return { type: "boolean", value: false };
          if (word === "null") return { type: "null" };
          throw new FormulaError("unexpected_token", { token: token.value, position: token.position });
        }
        next();
        enter();
        const args: FormulaNode[] = [];
        if (!isOp(")")) {
          args.push(or());
          while (isOp(",")) {
            next();
            args.push(or());
          }
        }
        expectOp(")");
        depth -= 1;
        if (word === "prop") {
          if (args.length !== 1) throw new FormulaError("wrong_argument_count", { name: "prop", expected: 1, actual: args.length });
          const [name] = args;
          if (name.type !== "string") throw new FormulaError("property_name_not_text");
          return { type: "property", name: name.value };
        }
        return { type: "call", name: word, args };
      }
    }
  }

  const tree = or();
  const rest = peek();
  if (rest.kind !== "end") throw new FormulaError("unexpected_token", { token: describe(rest), position: rest.position });
  return tree;
}

/** Property names a formula reads, for knowing when to recalculate it. */
export function formulaDependencies(node: FormulaNode): string[] {
  const names = new Set<string>();
  const walk = (current: FormulaNode) => {
    if (current.type === "property") names.add(current.name);
    else if (current.type === "unary") walk(current.operand);
    else if (current.type === "binary") {
      walk(current.left);
      walk(current.right);
    } else if (current.type === "call") current.args.forEach(walk);
  };
  walk(node);
  return [...names];
}
