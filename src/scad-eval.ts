import * as THREE from 'three';
import { Evaluator, Brush, ADDITION, SUBTRACTION, INTERSECTION } from 'three-bvh-csg';
import type { CSGOperation } from 'three-bvh-csg';
import type { ScadNode, ScadExpr, ScadArg, ModuleParam } from './scad-parser';

// ── Avaliador de expressões ──────────────────────────────────────────────────

type Env = Map<string, unknown>;

function evalExpr(expr: ScadExpr, env: Env): unknown {
  switch (expr.kind) {
    case 'num':  return expr.value;
    case 'bool': return expr.value;
    case 'str':  return expr.value;
    case 'var':  return env.has(expr.name) ? env.get(expr.name) : 0;

    case 'vec':
      return expr.items.map(e => evalExpr(e, env));

    case 'unary': {
      const v = evalExpr(expr.expr, env);
      if (expr.op === '-') return -(v as number);
      if (expr.op === '!') return !v;
      return v;
    }

    case 'binary': {
      const L = evalExpr(expr.left, env);
      const R = evalExpr(expr.right, env);
      switch (expr.op) {
        case '+':  return Array.isArray(L) && Array.isArray(R)
                     ? (L as number[]).map((v, i) => v + ((R as number[])[i] ?? 0))
                     : (L as number) + (R as number);
        case '-':  return (L as number) - (R as number);
        case '*':  return (L as number) * (R as number);
        case '/':  return (R as number) !== 0 ? (L as number) / (R as number) : 0;
        case '%':  return (L as number) % (R as number);
        case '==': return L === R;
        case '!=': return L !== R;
        case '<':  return (L as number) < (R as number);
        case '>':  return (L as number) > (R as number);
        case '<=': return (L as number) <= (R as number);
        case '>=': return (L as number) >= (R as number);
        case '&&': return !!L && !!R;
        case '||': return !!L || !!R;
      }
      return 0;
    }

    case 'ternary':
      return evalExpr(expr.cond, env) ? evalExpr(expr.then, env) : evalExpr(expr.else, env);

    case 'call':
      return callBuiltinFn(expr.name, expr.args, env);

    case 'index': {
      const arr = evalExpr(expr.expr, env);
      const idx = evalExpr(expr.idx, env) as number;
      return Array.isArray(arr) ? (arr as unknown[])[Math.round(idx)] ?? 0 : 0;
    }

    case 'member': {
      const obj = evalExpr(expr.expr, env) as Record<string, unknown>;
      return obj?.[expr.field] ?? 0;
    }
  }
}

function callBuiltinFn(name: string, args: ScadArg[], env: Env): unknown {
  const vals = args.map(a => evalExpr(a.value, env));
  const n = (i: number) => (vals[i] as number) ?? 0;
  switch (name) {
    case 'abs':   return Math.abs(n(0));
    case 'ceil':  return Math.ceil(n(0));
    case 'floor': return Math.floor(n(0));
    case 'round': return Math.round(n(0));
    case 'sqrt':  return Math.sqrt(n(0));
    case 'pow':   return Math.pow(n(0), n(1));
    case 'min':   return Math.min(...vals as number[]);
    case 'max':   return Math.max(...vals as number[]);
    case 'sin':   return Math.sin(n(0) * Math.PI / 180);
    case 'cos':   return Math.cos(n(0) * Math.PI / 180);
    case 'tan':   return Math.tan(n(0) * Math.PI / 180);
    case 'asin':  return Math.asin(n(0)) * 180 / Math.PI;
    case 'acos':  return Math.acos(n(0)) * 180 / Math.PI;
    case 'atan':  return Math.atan(n(0)) * 180 / Math.PI;
    case 'atan2': return Math.atan2(n(0), n(1)) * 180 / Math.PI;
    case 'log':   return Math.log(n(0));
    case 'exp':   return Math.exp(n(0));
    case 'len':   return Array.isArray(vals[0]) ? (vals[0] as unknown[]).length : 0;
    case 'str':   return vals.map(v => String(v)).join('');
    case 'concat':return (vals[0] as unknown[]).concat(...(vals.slice(1) as unknown[][]));
    case 'norm': {
      const v = vals[0] as number[];
      return Math.sqrt(v.reduce((s, x) => s + x * x, 0));
    }
    case 'cross': {
      const a = vals[0] as number[], b = vals[1] as number[];
      return [
        a[1]*b[2] - a[2]*b[1],
        a[2]*b[0] - a[0]*b[2],
        a[0]*b[1] - a[1]*b[0],
      ];
    }
    default: return 0;
  }
}

// ── Utilitários de coerção ───────────────────────────────────────────────────

function asNum(v: unknown, def = 0): number {
  if (typeof v === 'number') return isNaN(v) ? def : v;
  return def;
}

function asVec3(v: unknown, def: [number, number, number] = [1, 1, 1]): [number, number, number] {
  if (typeof v === 'number') return [v, v, v];
  if (Array.isArray(v)) {
    const a = v as unknown[];
    return [asNum(a[0], def[0]), asNum(a[1], def[1]), asNum(a[2], def[2])];
  }
  return def;
}

function asVec3Zero(v: unknown): [number, number, number] { return asVec3(v, [0, 0, 0]); }

function resolveArg(args: ScadArg[], env: Env, positionalIndex: number, namedKey: string): unknown {
  const named = args.find(a => a.name === namedKey);
  if (named) return evalExpr(named.value, env);
  const positional = args.filter(a => !a.name)[positionalIndex];
  if (positional) return evalExpr(positional.value, env);
  return undefined;
}

// ── CSG via three-bvh-csg ────────────────────────────────────────────────────

const csgEval = new Evaluator();
csgEval.useGroups = false;

function toBrush(mesh: THREE.Mesh): Brush {
  const b = new Brush(mesh.geometry.clone(), mesh.material);
  b.position.copy(mesh.position);
  b.rotation.copy(mesh.rotation);
  b.scale.copy(mesh.scale);
  b.updateMatrixWorld(true);
  return b;
}

function applyCSG(op: CSGOperation, meshes: THREE.Mesh[]): THREE.Mesh | null {
  if (meshes.length === 0) return null;
  if (meshes.length === 1) return meshes[0];
  try {
    let result: Brush = toBrush(meshes[0]);
    for (let i = 1; i < meshes.length; i++) {
      const next = toBrush(meshes[i]);
      const out = new Brush();
      csgEval.evaluate(result, next, op, out);
      result = out;
    }
    return result;
  } catch {
    return meshes[0];
  }
}

// ── Contexto de avaliação ────────────────────────────────────────────────────

interface EvalCtx {
  env: Env;
  modules: Map<string, { params: ModuleParam[]; body: ScadNode[] }>;
  functions: Map<string, { params: ModuleParam[]; expr: ScadExpr }>;
  color: THREE.Color;
  opacity: number;
  warnings: string[];
}

function cloneCtx(ctx: EvalCtx, envOverride?: Env): EvalCtx {
  return {
    ...ctx,
    env: envOverride ?? new Map(ctx.env),
    color: ctx.color.clone(),
  };
}

// ── Avaliador principal ──────────────────────────────────────────────────────

export function evalScad(nodes: ScadNode[]): { group: THREE.Group; warnings: string[] } {
  const ctx: EvalCtx = {
    env: new Map<string, unknown>([
      ['$fn', 32], ['$fa', 12], ['$fs', 2],
      ['PI', Math.PI], ['undef', undefined],
    ]),
    modules: new Map(),
    functions: new Map(),
    color: new THREE.Color(0x60a5fa),
    opacity: 1,
    warnings: [],
  };

  // Primeiro passe: coleta módulos, funções e atribuições
  collectDefs(nodes, ctx);

  const group = new THREE.Group();
  for (const obj of evalNodes(nodes, ctx)) {
    group.add(obj);
  }
  return { group, warnings: ctx.warnings };
}

function collectDefs(nodes: ScadNode[], ctx: EvalCtx) {
  for (const node of nodes) {
    if (node.kind === 'module_def') {
      ctx.modules.set(node.name, { params: node.params, body: node.body });
    } else if (node.kind === 'func_def') {
      ctx.functions.set(node.name, { params: node.params, expr: node.expr });
    } else if (node.kind === 'assign') {
      ctx.env.set(node.name, evalExpr(node.value, ctx.env));
    }
  }
}

function evalNodes(nodes: ScadNode[], ctx: EvalCtx): THREE.Object3D[] {
  const objects: THREE.Object3D[] = [];
  for (const node of nodes) {
    if (node.kind === 'assign') {
      ctx.env.set(node.name, evalExpr(node.value, ctx.env));
      continue;
    }
    if (node.kind === 'module_def' || node.kind === 'func_def') continue;
    const objs = evalNode(node, ctx);
    objects.push(...objs);
  }
  return objects;
}

function evalNode(node: ScadNode, ctx: EvalCtx): THREE.Object3D[] {
  switch (node.kind) {
    case 'assign':
      ctx.env.set(node.name, evalExpr(node.value, ctx.env));
      return [];

    case 'if': {
      const cond = evalExpr(node.cond, ctx.env);
      if (cond) return evalNodes(node.then, ctx);
      if (node.else) return evalNodes(node.else, ctx);
      return [];
    }

    case 'for': {
      const rangeVal = evalExpr(node.range, ctx.env);
      const values = expandRange(rangeVal);
      const objects: THREE.Object3D[] = [];
      for (const v of values.slice(0, 200)) {
        const subCtx = cloneCtx(ctx);
        subCtx.env.set(node.var, v);
        objects.push(...evalNodes(node.body, subCtx));
      }
      return objects;
    }

    case 'block':
      return evalNodes(node.body, ctx);

    case 'call':
      return evalCall(node.name, node.args, node.children, ctx);

    default:
      return [];
  }
}

function expandRange(v: unknown): unknown[] {
  if (Array.isArray(v)) {
    const a = v as number[];
    // Vetor simples: iterar sobre elementos
    if (typeof a[0] !== 'number' || typeof a[1] !== 'number') return a;
    // Formato [start:end] ou [start:step:end]
    if (a.length === 2) {
      const [start, end] = a;
      const result: number[] = [];
      for (let x = start; x <= end; x++) result.push(x);
      return result;
    }
    if (a.length === 3) {
      const [start, step, end] = a;
      const result: number[] = [];
      const s = step === 0 ? 1 : Math.abs(step);
      const dir = end >= start ? 1 : -1;
      for (let x = start; dir * x <= dir * end; x += dir * s) result.push(x);
      return result;
    }
    return a;
  }
  return [];
}

// ── Chamada de módulo ────────────────────────────────────────────────────────

function evalCall(
  name: string,
  args: ScadArg[],
  children: ScadNode[],
  ctx: EvalCtx
): THREE.Object3D[] {

  // Módulos definidos pelo usuário
  if (ctx.modules.has(name)) {
    return evalUserModule(name, args, children, ctx);
  }

  const fn = asNum(ctx.env.get('$fn'), 32);

  // ── Primitivos ──
  switch (name) {
    case 'cube': {
      const sizeArg = resolveArg(args, ctx.env, 0, 'size');
      const [w, h, d] = asVec3(sizeArg ?? evalExpr(args[0]?.value ?? { kind: 'num', value: 1 }, ctx.env));
      const center = !!resolveArg(args, ctx.env, 1, 'center');
      const geo = new THREE.BoxGeometry(w, h, d);
      if (!center) geo.translate(w / 2, h / 2, d / 2);
      return [makeMesh(geo, ctx)];
    }

    case 'sphere': {
      const r = asNum(resolveArg(args, ctx.env, 0, 'r') ?? resolveArg(args, ctx.env, 0, 'd'), 1);
      const isD = !!args.find(a => a.name === 'd');
      const radius = isD ? r / 2 : r;
      const segs = Math.max(4, Math.round(fn));
      const geo = new THREE.SphereGeometry(radius, segs, Math.max(2, Math.round(segs / 2)));
      return [makeMesh(geo, ctx)];
    }

    case 'cylinder': {
      const h = asNum(resolveArg(args, ctx.env, 0, 'h'), 1);
      const r1raw = resolveArg(args, ctx.env, 1, 'r1') ?? resolveArg(args, ctx.env, 1, 'r');
      const r2raw = resolveArg(args, ctx.env, 2, 'r2') ?? r1raw;
      const r1 = asNum(r1raw, 1);
      const r2 = asNum(r2raw, r1);
      const center = !!resolveArg(args, ctx.env, 3, 'center');
      const segs = Math.max(3, Math.round(fn));
      const geo = new THREE.CylinderGeometry(r2, r1, h, segs);
      if (!center) geo.translate(0, h / 2, 0);
      // SCAD usa Z-up; Three.js usa Y-up: cilindro Three.js já é Y-up, ok
      return [makeMesh(geo, ctx)];
    }

    case 'polyhedron': {
      ctx.warnings.push('polyhedron: suporte parcial');
      const geo = new THREE.BoxGeometry(1, 1, 1);
      return [makeMesh(geo, ctx)];
    }

    // ── Transforms ──
    case 'translate': {
      const v = asVec3Zero(resolveArg(args, ctx.env, 0, 'v'));
      const g = new THREE.Group();
      g.position.set(...scadToThree(v));
      evalNodes(children, ctx).forEach(o => g.add(o));
      return [g];
    }

    case 'rotate': {
      const rv = resolveArg(args, ctx.env, 0, 'a') ?? resolveArg(args, ctx.env, 0, 'v');
      const g = new THREE.Group();
      if (Array.isArray(rv)) {
        const [rx, ry, rz] = asVec3Zero(rv);
        // SCAD: rotate([x,y,z]) em graus, ordem ZYX
        g.rotation.set(rx * Math.PI / 180, ry * Math.PI / 180, rz * Math.PI / 180, 'ZYX');
      } else {
        const angle = asNum(rv, 0) * Math.PI / 180;
        const axis = asVec3Zero(resolveArg(args, ctx.env, 1, 'v'));
        const q = new THREE.Quaternion().setFromAxisAngle(
          new THREE.Vector3(...scadToThree(axis)).normalize(),
          angle
        );
        g.quaternion.copy(q);
      }
      evalNodes(children, ctx).forEach(o => g.add(o));
      return [g];
    }

    case 'scale': {
      const s = asVec3(resolveArg(args, ctx.env, 0, 'v'), [1, 1, 1]);
      const g = new THREE.Group();
      g.scale.set(s[0], s[1], s[2]);
      evalNodes(children, ctx).forEach(o => g.add(o));
      return [g];
    }

    case 'mirror': {
      const v = asVec3Zero(resolveArg(args, ctx.env, 0, 'v'));
      const g = new THREE.Group();
      // Mirror: negativa escala no eixo
      const [mx, my, mz] = scadToThree(v);
      g.scale.set(mx !== 0 ? -1 : 1, my !== 0 ? -1 : 1, mz !== 0 ? -1 : 1);
      evalNodes(children, ctx).forEach(o => g.add(o));
      return [g];
    }

    case 'resize': {
      const newSize = asVec3(resolveArg(args, ctx.env, 0, 'newsize'), [1, 1, 1]);
      const g = new THREE.Group();
      g.scale.set(newSize[0], newSize[1], newSize[2]);
      evalNodes(children, ctx).forEach(o => g.add(o));
      return [g];
    }

    case 'multmatrix': {
      const matVal = resolveArg(args, ctx.env, 0, 'm');
      const g = new THREE.Group();
      if (Array.isArray(matVal)) {
        const flat = (matVal as number[][]).flat();
        if (flat.length >= 16) {
          const m4 = new THREE.Matrix4();
          m4.set(...(flat.slice(0, 16) as Parameters<THREE.Matrix4['set']>));
          g.applyMatrix4(m4);
        }
      }
      evalNodes(children, ctx).forEach(o => g.add(o));
      return [g];
    }

    // ── Cor ──
    case 'color': {
      const subCtx = cloneCtx(ctx);
      const colorArg = resolveArg(args, ctx.env, 0, 'c') ?? resolveArg(args, ctx.env, 0, 'color');
      const alphaArg = resolveArg(args, ctx.env, 1, 'alpha');
      if (typeof colorArg === 'string') {
        try { subCtx.color.setStyle(colorArg); } catch { /* ignora cor inválida */ }
      } else if (Array.isArray(colorArg)) {
        const [r, g2, b] = colorArg as number[];
        subCtx.color.setRGB(r, g2, b);
        if (colorArg.length >= 4) subCtx.opacity = (colorArg as number[])[3];
      }
      if (alphaArg !== undefined) subCtx.opacity = asNum(alphaArg, 1);
      return evalNodes(children, subCtx);
    }

    // ── CSG ──
    case 'union': {
      const meshes = flatMeshes(evalNodes(children, ctx));
      const result = applyCSG(ADDITION, meshes);
      return result ? [result] : [];
    }

    case 'difference': {
      const meshes = flatMeshes(evalNodes(children, ctx));
      const result = applyCSG(SUBTRACTION, meshes);
      return result ? [result] : [];
    }

    case 'intersection': {
      const meshes = flatMeshes(evalNodes(children, ctx));
      const result = applyCSG(INTERSECTION, meshes);
      return result ? [result] : [];
    }

    // ── Minkowski (aproximado: apenas retorna os filhos) ──
    case 'minkowski': {
      ctx.warnings.push('minkowski: renderização aproximada');
      return evalNodes(children, ctx);
    }

    // ── Hull (aproximado) ──
    case 'hull': {
      ctx.warnings.push('hull: renderização aproximada');
      return evalNodes(children, ctx);
    }

    // ── linear_extrude ──
    case 'linear_extrude': {
      // Aproximação: apenas empilha os filhos com altura
      const height = asNum(resolveArg(args, ctx.env, 0, 'height'), 1);
      const g = new THREE.Group();
      g.scale.set(1, height, 1);
      evalNodes(children, ctx).forEach(o => g.add(o));
      return [g];
    }

    // ── Grupos sem operação ──
    case 'group':
    case 'render': {
      const g = new THREE.Group();
      evalNodes(children, ctx).forEach(o => g.add(o));
      return [g];
    }

    // ── Ignorados silenciosamente ──
    case 'echo':
    case 'assert':
    case 'import':
    case 'use':
    case 'include':
      return [];

    default:
      ctx.warnings.push(`'${name}': módulo não reconhecido`);
      return [];
  }
}

// ── Módulos do usuário ────────────────────────────────────────────────────────

function evalUserModule(
  name: string,
  args: ScadArg[],
  children: ScadNode[],
  ctx: EvalCtx
): THREE.Object3D[] {
  const def = ctx.modules.get(name)!;
  const subEnv = new Map(ctx.env);

  // Vincula parâmetros posicionais e nomeados
  let posIdx = 0;
  for (const param of def.params) {
    const named = args.find(a => a.name === param.name);
    if (named) {
      subEnv.set(param.name, evalExpr(named.value, ctx.env));
    } else {
      const positional = args.filter(a => !a.name)[posIdx];
      if (positional) {
        subEnv.set(param.name, evalExpr(positional.value, ctx.env));
        posIdx++;
      } else if (param.default) {
        subEnv.set(param.name, evalExpr(param.default, subEnv));
      }
    }
  }

  const subCtx = cloneCtx(ctx, subEnv);
  // Permite $children via "children()" — simplificado: injeta os filhos como nó especial
  subCtx.modules.set('children', {
    params: [],
    body: children.length > 0 ? children : [],
  });

  collectDefs(def.body, subCtx);
  return evalNodes(def.body, subCtx);
}

// ── Helpers ──────────────────────────────────────────────────────────────────

// SCAD usa Z-up, Three.js usa Y-up.
// Convertemos: SCAD[x,y,z] → Three.js[x, z, -y]
function scadToThree(v: [number, number, number]): [number, number, number] {
  return [v[0], v[2], -v[1]];
}

function makeMesh(geo: THREE.BufferGeometry, ctx: EvalCtx): THREE.Mesh {
  const mat = new THREE.MeshStandardMaterial({
    color: ctx.color.clone(),
    opacity: ctx.opacity,
    transparent: ctx.opacity < 1,
    roughness: 0.5,
    metalness: 0.1,
    side: THREE.DoubleSide,
  });
  return new THREE.Mesh(geo, mat);
}

function flatMeshes(objects: THREE.Object3D[]): THREE.Mesh[] {
  const meshes: THREE.Mesh[] = [];
  const collect = (obj: THREE.Object3D) => {
    // Aplica transformações acumuladas antes de CSG
    obj.updateWorldMatrix(true, true);
    if (obj instanceof THREE.Mesh) {
      // Bake da matrix no geometry para CSG
      const clone = obj.clone();
      const geo = obj.geometry.clone();
      geo.applyMatrix4(obj.matrixWorld);
      clone.geometry = geo;
      clone.position.set(0, 0, 0);
      clone.rotation.set(0, 0, 0);
      clone.scale.set(1, 1, 1);
      clone.updateMatrix();
      meshes.push(clone);
    }
    obj.children.forEach(collect);
  };
  objects.forEach(collect);
  return meshes;
}
