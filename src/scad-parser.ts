// Tokenizador + parser recursivo descente para um subconjunto de OpenSCAD

export type TokenKind =
  | 'ident' | 'number' | 'string' | 'bool'
  | '+' | '-' | '*' | '/' | '%' | '!'
  | '==' | '!=' | '<' | '>' | '<=' | '>='
  | '&&' | '||'
  | '=' | ';' | ',' | '.' | '?'  | ':'
  | '(' | ')' | '{' | '}' | '[' | ']'
  | 'eof';

export interface Token {
  kind: TokenKind;
  value: string;
  pos: number;
}

// ── Tokenizador ──────────────────────────────────────────────────────────────

export function tokenize(src: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;

  while (i < src.length) {
    // Espaço
    if (/\s/.test(src[i])) { i++; continue; }

    // Comentário de linha
    if (src[i] === '/' && src[i + 1] === '/') {
      while (i < src.length && src[i] !== '\n') i++;
      continue;
    }

    // Comentário de bloco
    if (src[i] === '/' && src[i + 1] === '*') {
      i += 2;
      while (i < src.length && !(src[i] === '*' && src[i + 1] === '/')) i++;
      i += 2;
      continue;
    }

    const pos = i;

    // String
    if (src[i] === '"') {
      i++;
      let s = '';
      while (i < src.length && src[i] !== '"') {
        if (src[i] === '\\') { i++; s += src[i] ?? ''; } else { s += src[i]; }
        i++;
      }
      i++;
      tokens.push({ kind: 'string', value: s, pos });
      continue;
    }

    // Número
    if (/[0-9]/.test(src[i]) || (src[i] === '.' && /[0-9]/.test(src[i + 1] ?? ''))) {
      let s = '';
      while (i < src.length && /[0-9.eE+\-]/.test(src[i])) { s += src[i++]; }
      tokens.push({ kind: 'number', value: s, pos });
      continue;
    }

    // Identificador / palavra-chave
    if (/[a-zA-Z_$]/.test(src[i])) {
      let s = '';
      while (i < src.length && /[a-zA-Z0-9_$]/.test(src[i])) { s += src[i++]; }
      if (s === 'true' || s === 'false') {
        tokens.push({ kind: 'bool', value: s, pos });
      } else {
        tokens.push({ kind: 'ident', value: s, pos });
      }
      continue;
    }

    // Operadores de 2 chars
    const two = src.slice(i, i + 2);
    const twoMap: Partial<Record<string, TokenKind>> = {
      '==': '==', '!=': '!=', '<=': '<=', '>=': '>=',
      '&&': '&&', '||': '||',
    };
    if (twoMap[two]) {
      tokens.push({ kind: twoMap[two]!, value: two, pos });
      i += 2;
      continue;
    }

    // Operadores de 1 char
    const one = src[i];
    const oneMap: Partial<Record<string, TokenKind>> = {
      '+': '+', '-': '-', '*': '*', '/': '/', '%': '%', '!': '!',
      '=': '=', ';': ';', ',': ',', '.': '.', '?': '?', ':': ':',
      '(': '(', ')': ')', '{': '{', '}': '}', '[': '[', ']': ']',
      '<': '<', '>': '>',
    };
    if (oneMap[one]) {
      tokens.push({ kind: oneMap[one]!, value: one, pos });
      i++;
      continue;
    }

    // Caractere desconhecido — pula
    i++;
  }

  tokens.push({ kind: 'eof', value: '', pos: i });
  return tokens;
}

// ── AST ──────────────────────────────────────────────────────────────────────

export type ScadExpr =
  | { kind: 'num';   value: number }
  | { kind: 'bool';  value: boolean }
  | { kind: 'str';   value: string }
  | { kind: 'var';   name: string }
  | { kind: 'vec';   items: ScadExpr[] }
  | { kind: 'unary'; op: string; expr: ScadExpr }
  | { kind: 'binary'; op: string; left: ScadExpr; right: ScadExpr }
  | { kind: 'ternary'; cond: ScadExpr; then: ScadExpr; else: ScadExpr }
  | { kind: 'call';  name: string; args: ScadArg[] }
  | { kind: 'index'; expr: ScadExpr; idx: ScadExpr }
  | { kind: 'member'; expr: ScadExpr; field: string };

export interface ScadArg {
  name?: string;
  value: ScadExpr;
}

export type ScadNode =
  | { kind: 'module_def'; name: string; params: ModuleParam[]; body: ScadNode[] }
  | { kind: 'func_def';   name: string; params: ModuleParam[]; expr: ScadExpr }
  | { kind: 'assign';     name: string; value: ScadExpr }
  | { kind: 'call';       name: string; args: ScadArg[]; children: ScadNode[] }
  | { kind: 'if';         cond: ScadExpr; then: ScadNode[]; else?: ScadNode[] }
  | { kind: 'for';        var: string; range: ScadExpr; body: ScadNode[] }
  | { kind: 'block';      body: ScadNode[] };

export interface ModuleParam {
  name: string;
  default?: ScadExpr;
}

// ── Parser ───────────────────────────────────────────────────────────────────

export function parseScadAst(src: string): ScadNode[] {
  const tokens = tokenize(src);
  let pos = 0;

  const peek = () => tokens[pos];
  const next = () => tokens[pos++];
  const check = (k: TokenKind) => peek().kind === k;
  const eat = (k: TokenKind) => { if (check(k)) { next(); return true; } return false; };
  const expect = (k: TokenKind) => { if (!check(k)) throw new Error(`Expected ${k} got ${peek().kind}`); return next(); };

  // Precedências de operadores binários
  const PREC: Record<string, number> = {
    '||': 1, '&&': 2,
    '==': 3, '!=': 3,
    '<': 4, '>': 4, '<=': 4, '>=': 4,
    '+': 5, '-': 5,
    '*': 6, '/': 6, '%': 6,
  };

  function parseExpr(): ScadExpr { return parseTernary(); }

  function parseTernary(): ScadExpr {
    let e = parseBinary(0);
    if (eat('?')) {
      const t = parseExpr();
      expect(':');
      const f = parseExpr();
      e = { kind: 'ternary', cond: e, then: t, else: f };
    }
    return e;
  }

  function parseBinary(minPrec: number): ScadExpr {
    let left = parseUnary();
    while (true) {
      const op = peek().kind;
      const prec = PREC[op] ?? -1;
      if (prec <= minPrec) break;
      next();
      const right = parseBinary(prec);
      left = { kind: 'binary', op, left, right };
    }
    return left;
  }

  function parseUnary(): ScadExpr {
    if (check('-') || check('!')) {
      const op = next().value;
      return { kind: 'unary', op, expr: parseUnary() };
    }
    return parsePostfix();
  }

  function parsePostfix(): ScadExpr {
    let e = parsePrimary();
    while (true) {
      if (eat('[')) {
        const idx = parseExpr();
        expect(']');
        e = { kind: 'index', expr: e, idx };
      } else if (eat('.')) {
        const field = expect('ident').value;
        e = { kind: 'member', expr: e, field };
      } else {
        break;
      }
    }
    return e;
  }

  function parsePrimary(): ScadExpr {
    const t = peek();

    if (t.kind === 'number') { next(); return { kind: 'num', value: parseFloat(t.value) }; }
    if (t.kind === 'bool')   { next(); return { kind: 'bool', value: t.value === 'true' }; }
    if (t.kind === 'string') { next(); return { kind: 'str', value: t.value }; }

    if (t.kind === 'ident') {
      next();
      // Chamada de função/módulo inline
      if (check('(')) {
        next();
        const args = parseArgList();
        expect(')');
        return { kind: 'call', name: t.value, args };
      }
      return { kind: 'var', name: t.value };
    }

    if (eat('[')) {
      const items: ScadExpr[] = [];
      if (!check(']')) {
        items.push(parseExpr());
        while (eat(',') && !check(']')) items.push(parseExpr());
      }
      expect(']');
      return { kind: 'vec', items };
    }

    if (eat('(')) {
      const e = parseExpr();
      expect(')');
      return e;
    }

    // Fallback: consome e retorna 0
    next();
    return { kind: 'num', value: 0 };
  }

  function parseArgList(): ScadArg[] {
    const args: ScadArg[] = [];
    if (check(')') || check(']')) return args;
    do {
      // arg nomeado: name = expr
      if (tokens[pos].kind === 'ident' && tokens[pos + 1]?.kind === '=') {
        const name = next().value;
        next(); // '='
        args.push({ name, value: parseExpr() });
      } else {
        args.push({ value: parseExpr() });
      }
    } while (eat(',') && !check(')') && !check(']') && !check('eof'));
    return args;
  }

  function parseModuleParams(): ModuleParam[] {
    const params: ModuleParam[] = [];
    if (check(')')) return params;
    do {
      const name = expect('ident').value;
      const param: ModuleParam = { name };
      if (eat('=')) param.default = parseExpr();
      params.push(param);
    } while (eat(',') && !check(')') && !check('eof'));
    return params;
  }

  function parseBody(): ScadNode[] {
    if (eat('{')) {
      const nodes: ScadNode[] = [];
      while (!check('}') && !check('eof')) nodes.push(...parseStatement());
      eat('}');
      return nodes;
    }
    return parseStatement();
  }

  function parseStatement(): ScadNode[] {
    const t = peek();

    // module def
    if (t.kind === 'ident' && t.value === 'module') {
      next();
      const name = expect('ident').value;
      expect('(');
      const params = parseModuleParams();
      expect(')');
      const body = parseBody();
      return [{ kind: 'module_def', name, params, body }];
    }

    // function def
    if (t.kind === 'ident' && t.value === 'function') {
      next();
      const name = expect('ident').value;
      expect('(');
      const params = parseModuleParams();
      expect(')');
      expect('=');
      const expr = parseExpr();
      eat(';');
      return [{ kind: 'func_def', name, params, expr }];
    }

    // if
    if (t.kind === 'ident' && t.value === 'if') {
      next();
      expect('(');
      const cond = parseExpr();
      expect(')');
      const then = parseBody();
      let elseNode: ScadNode[] | undefined;
      if (peek().kind === 'ident' && peek().value === 'else') {
        next();
        elseNode = parseBody();
      }
      return [{ kind: 'if', cond, then, else: elseNode }];
    }

    // for
    if (t.kind === 'ident' && t.value === 'for') {
      next();
      expect('(');
      const varName = expect('ident').value;
      expect('=');
      const range = parseExpr();
      expect(')');
      const body = parseBody();
      return [{ kind: 'for', var: varName, range, body }];
    }

    // include/use — pula
    if (t.kind === 'ident' && (t.value === 'include' || t.value === 'use')) {
      while (!check(';') && !check('eof') && !check('{')) next();
      eat(';');
      return [];
    }

    // atribuição: ident = expr ;
    if (t.kind === 'ident' && tokens[pos + 1]?.kind === '=') {
      const name = next().value;
      next(); // '='
      const value = parseExpr();
      eat(';');
      return [{ kind: 'assign', name, value }];
    }

    // Chamada de módulo/operação: ident(...) { children } ou ident(...);
    if (t.kind === 'ident') {
      next();
      const args: ScadArg[] = [];
      if (eat('(')) {
        args.push(...parseArgList());
        expect(')');
      }

      // children
      let children: ScadNode[] = [];
      if (check('{')) {
        children = parseBody();
      } else if (!eat(';')) {
        // Filho único sem chaves
        children = parseStatement();
      }
      return [{ kind: 'call', name: t.value, args, children }];
    }

    // ponto-e-vírgula solto
    if (eat(';')) return [];

    // Fallback: avança
    next();
    return [];
  }

  const nodes: ScadNode[] = [];
  while (!check('eof')) {
    nodes.push(...parseStatement());
  }
  return nodes;
}
