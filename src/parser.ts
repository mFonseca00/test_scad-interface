// Tipos possíveis de um parâmetro SCAD
export type ScadParamType = 'number' | 'boolean' | 'string' | 'vector' | 'unknown';

export interface ScadParam {
  name: string;
  type: ScadParamType;
  originalValue: string;    // texto bruto como estava no arquivo
  currentValue: string;     // texto bruto com o valor editado
  comment?: string;         // comentário inline (// ...) se houver
  line: number;             // número da linha (0-based)
  // metadados de range para números (tirados de comentários como // [min:max:step])
  rangeMin?: number;
  rangeMax?: number;
  rangeStep?: number;
}

export interface ParseResult {
  params: ScadParam[];
  lines: string[];          // linhas originais do arquivo
}

// Extrai hint de range de comentários do tipo:  // [0:100]  ou  // [0:1:100]
function extractRangeHint(comment: string): Pick<ScadParam, 'rangeMin' | 'rangeMax' | 'rangeStep'> {
  const m = comment.match(/\[(\s*-?\d+(?:\.\d+)?)\s*:\s*(-?\d+(?:\.\d+)?)\s*(?::\s*(-?\d+(?:\.\d+)?)\s*)?\]/);
  if (!m) return {};
  const a = parseFloat(m[1]);
  const b = parseFloat(m[2]);
  const c = m[3] !== undefined ? parseFloat(m[3]) : undefined;
  // formato [min:max] ou [min:step:max] (OpenSCAD usa [min:step:max])
  if (c !== undefined) {
    return { rangeMin: a, rangeStep: b, rangeMax: c };
  }
  return { rangeMin: a, rangeMax: b };
}

function inferType(rawValue: string): ScadParamType {
  const v = rawValue.trim();
  if (v === 'true' || v === 'false') return 'boolean';
  if (v.startsWith('"') || v.startsWith("'")) return 'string';
  if (v.startsWith('[')) return 'vector';
  if (!isNaN(Number(v)) && v !== '') return 'number';
  return 'unknown';
}

// Regex para capturar atribuições de variável no nível raiz.
// Não entra dentro de módulos/funções (heurística simples: ignora linhas indentadas).
const ASSIGN_RE = /^([a-zA-Z_][a-zA-Z0-9_]*)\s*=\s*((?:"[^"]*"|'[^']*'|\[[^\]]*\]|[^;]+))\s*;(.*)$/;

export function parseScad(source: string): ParseResult {
  const lines = source.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
  const params: ScadParam[] = [];
  let inBlockComment = false;

  for (let i = 0; i < lines.length; i++) {
    let line = lines[i];

    // Gerencia comentários de bloco /* */
    if (inBlockComment) {
      if (line.includes('*/')) {
        inBlockComment = false;
        line = line.slice(line.indexOf('*/') + 2);
      } else {
        continue;
      }
    }

    if (line.includes('/*') && !line.includes('*/')) {
      inBlockComment = true;
      line = line.slice(0, line.indexOf('/*'));
    }

    // Ignora linhas com comentário de linha inteira
    const trimmed = line.trimStart();
    if (trimmed.startsWith('//')) continue;

    // Ignora linhas indentadas (dentro de módulo/função)
    if (line.length > 0 && (line[0] === ' ' || line[0] === '\t')) continue;

    // Tenta casar com atribuição de variável
    const match = trimmed.match(ASSIGN_RE);
    if (!match) continue;

    const [, name, rawValue, afterSemicolon] = match;

    // Ignora special: $fn, $fa, $fs (são configurações, não parâmetros reais de modelo)
    // mas mantemos se o usuário quiser editá-los
    const inlineComment = afterSemicolon
      ? afterSemicolon.replace(/^\s*\/\/\s*/, '').trim()
      : undefined;

    const type = inferType(rawValue.trim());
    const { rangeMin, rangeMax, rangeStep } = inlineComment
      ? extractRangeHint(inlineComment)
      : {};

    // Defaults de range por tipo
    const finalRangeMin = rangeMin ?? (type === 'number' ? -100 : undefined);
    const finalRangeMax = rangeMax ?? (type === 'number' ? 100 : undefined);
    const finalRangeStep = rangeStep ?? (type === 'number' ? 1 : undefined);

    params.push({
      name,
      type,
      originalValue: rawValue.trim(),
      currentValue: rawValue.trim(),
      comment: inlineComment || undefined,
      line: i,
      rangeMin: finalRangeMin,
      rangeMax: finalRangeMax,
      rangeStep: finalRangeStep,
    });
  }

  return { params, lines };
}

// Reconstrói o código-fonte aplicando os valores atuais dos parâmetros
export function applyParams(lines: string[], params: ScadParam[]): string {
  const result = [...lines];
  for (const p of params) {
    const original = result[p.line];
    // Substitui apenas o valor, preservando o restante da linha
    result[p.line] = original.replace(
      /^([a-zA-Z_][a-zA-Z0-9_]*\s*=\s*)(?:"[^"]*"|'[^']*'|\[[^\]]*\]|[^;]+)(\s*;)/,
      (_full, prefix, suffix) => `${prefix}${p.currentValue}${suffix}`
    );
  }
  return result.join('\n');
}
