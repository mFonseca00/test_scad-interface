import { parseScad, applyParams, type ScadParam, type ParseResult } from './parser';
import { parseScadAst } from './scad-parser';
import { evalScad } from './scad-eval';
import { ScadViewer } from './viewer';

// ── Estado global ──────────────────────────────────────────────────────────
let state: ParseResult | null = null;
let currentTab: 'modified' | 'original' | 'diff' = 'modified';
let viewer: ScadViewer | null = null;
let renderPending = false;

// ── Referências ao DOM ─────────────────────────────────────────────────────
const fileInput       = document.getElementById('hidden-file') as HTMLInputElement;
const fileNameEl      = document.getElementById('file-name') as HTMLElement;
const paramsList      = document.getElementById('params-list') as HTMLElement;
const codeOutput      = document.getElementById('code-output') as HTMLElement;
const copyBtn         = document.getElementById('copy-btn') as HTMLButtonElement;
const statParams      = document.getElementById('stat-params') as HTMLElement;
const statLines       = document.getElementById('stat-lines') as HTMLElement;
const statChanged     = document.getElementById('stat-changed') as HTMLElement;
const statWarnings    = document.getElementById('stat-warnings') as HTMLElement;
const viewerContainer = document.getElementById('viewer-container') as HTMLElement;
const viewerEmpty     = document.getElementById('viewer-empty') as HTMLElement;
const viewerStatus    = document.getElementById('viewer-status') as HTMLElement;
const viewerStatusTxt = document.getElementById('viewer-status-text') as HTMLElement;
const renderSpinner   = document.getElementById('render-spinner') as HTMLElement;
const wireframeBtn    = document.getElementById('wireframe-btn') as HTMLButtonElement;
const resetCamBtn     = document.getElementById('reset-cam-btn') as HTMLButtonElement;

// ── Carregamento de arquivo ────────────────────────────────────────────────
fileInput.addEventListener('change', () => {
  const file = fileInput.files?.[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = (e) => {
    const source = e.target?.result as string;
    state = parseScad(source);
    fileNameEl.textContent = file.name;
    fileNameEl.classList.add('loaded');

    // Inicializa viewer se ainda não existe
    if (!viewer) {
      viewerEmpty.style.display = 'none';
      viewer = new ScadViewer(viewerContainer);
    }

    renderParams();
    renderCode();
    scheduleRender3D();
    updateStats();
  };
  reader.readAsText(file);
});

// ── Viewer: wireframe e reset câmera ──────────────────────────────────────
wireframeBtn.addEventListener('click', () => {
  if (!viewer) return;
  const wf = viewer.toggleWireframe();
  wireframeBtn.classList.toggle('active', wf);
});

resetCamBtn.addEventListener('click', () => {
  viewer?.resetCamera();
});

// ── Tabs ───────────────────────────────────────────────────────────────────
document.querySelectorAll<HTMLButtonElement>('.tab-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    currentTab = btn.dataset.tab as typeof currentTab;
    renderCode();
  });
});

// ── Copiar código ──────────────────────────────────────────────────────────
copyBtn.addEventListener('click', () => {
  const text = codeOutput.textContent ?? '';
  navigator.clipboard.writeText(text).then(() => {
    copyBtn.classList.add('copied');
    const textNode = copyBtn.childNodes[copyBtn.childNodes.length - 1];
    textNode.textContent = ' Copiado!';
    setTimeout(() => {
      copyBtn.classList.remove('copied');
      textNode.textContent = ' Copiar';
    }, 2000);
  });
});

// ── Render 3D (debounced via rAF) ─────────────────────────────────────────
function scheduleRender3D() {
  if (renderPending) return;
  renderPending = true;
  requestAnimationFrame(() => {
    renderPending = false;
    render3D();
  });
}

function render3D() {
  if (!state || !viewer) return;

  setViewerStatus('rendering', 'Renderizando...');

  try {
    const modifiedSource = applyParams(state.lines, state.params);
    const ast = parseScadAst(modifiedSource);
    const { group, warnings } = evalScad(ast);

    viewer.setGeometry(group);

    if (warnings.length > 0) {
      setViewerStatus('warning', `⚠ ${[...new Set(warnings)].join(' · ')}`);
      statWarnings.textContent = String(warnings.length);
      statWarnings.style.color = '#fbbf24';
    } else {
      setViewerStatus('ok', '');
      statWarnings.textContent = '0';
      statWarnings.style.color = '';
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    setViewerStatus('error', `Erro: ${msg}`);
    console.error('[scad-eval]', err);
  }
}

function setViewerStatus(type: 'rendering' | 'warning' | 'error' | 'ok', text: string) {
  if (type === 'ok' || text === '') {
    viewerStatus.style.display = 'none';
    renderSpinner.classList.remove('visible');
    return;
  }
  viewerStatus.style.display = 'flex';
  viewerStatus.className = 'viewer-status ' + (type === 'rendering' ? '' : type);
  viewerStatusTxt.textContent = text;
  renderSpinner.classList.toggle('visible', type === 'rendering');
}

// ── Renderização dos parâmetros ────────────────────────────────────────────
function renderParams() {
  if (!state || state.params.length === 0) {
    paramsList.innerHTML = `
      <div class="empty-state">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
          <path d="M9.172 16.172a4 4 0 0 1 5.656 0"/>
          <line x1="9" y1="9" x2="9.01" y2="9"/>
          <line x1="15" y1="9" x2="15.01" y2="9"/>
          <circle cx="12" cy="12" r="10"/>
        </svg>
        <p>Nenhuma variável encontrada<br>no nível raiz do arquivo.</p>
      </div>`;
    return;
  }

  paramsList.innerHTML = '';
  for (const param of state.params) {
    paramsList.appendChild(buildParamItem(param));
  }
}

function buildParamItem(param: ScadParam): HTMLElement {
  const wrapper = document.createElement('div');
  wrapper.className = 'param-item';
  wrapper.dataset.name = param.name;

  const labelRow = document.createElement('div');
  labelRow.className = 'param-label';

  const nameEl = document.createElement('span');
  nameEl.className = 'param-name';
  nameEl.textContent = param.name;

  const typeEl = document.createElement('span');
  typeEl.className = `param-type type-${param.type}`;
  typeEl.textContent = param.type;

  labelRow.appendChild(nameEl);
  labelRow.appendChild(typeEl);
  wrapper.appendChild(labelRow);

  if (param.comment && !param.comment.match(/^\[/)) {
    const commentEl = document.createElement('div');
    commentEl.style.cssText = 'font-size:11px; color:#475569; font-style:italic;';
    commentEl.textContent = `// ${param.comment}`;
    wrapper.appendChild(commentEl);
  }

  switch (param.type) {
    case 'number':  wrapper.appendChild(buildNumberControl(param)); break;
    case 'boolean': wrapper.appendChild(buildBooleanControl(param)); break;
    case 'string':  wrapper.appendChild(buildStringControl(param)); break;
    case 'vector':  wrapper.appendChild(buildVectorControl(param)); break;
    default:        wrapper.appendChild(buildTextFallback(param)); break;
  }

  return wrapper;
}

function onChange() {
  renderCode();
  scheduleRender3D();
  updateStats();
}

function buildNumberControl(param: ScadParam): HTMLElement {
  const div = document.createElement('div');
  div.className = 'number-wrapper';

  const top = document.createElement('div');
  top.className = 'number-top';

  const slider = document.createElement('input');
  slider.type = 'range';
  slider.min = String(param.rangeMin ?? -100);
  slider.max = String(param.rangeMax ?? 100);
  slider.step = String(param.rangeStep ?? 1);
  slider.value = param.currentValue;

  const numInput = document.createElement('input');
  numInput.type = 'number';
  numInput.step = String(param.rangeStep ?? 1);
  numInput.value = param.currentValue;

  const syncValue = (val: string) => {
    param.currentValue = val;
    slider.value = val;
    numInput.value = val;
    onChange();
    highlightParamRow(param.name);
  };

  slider.addEventListener('input', () => syncValue(slider.value));
  numInput.addEventListener('change', () => syncValue(numInput.value));
  numInput.addEventListener('input', () => {
    slider.value = numInput.value;
    param.currentValue = numInput.value;
    onChange();
    highlightParamRow(param.name);
  });

  top.appendChild(slider);
  top.appendChild(numInput);
  div.appendChild(top);

  const rangeConf = document.createElement('div');
  rangeConf.className = 'range-config';
  rangeConf.appendChild(document.createTextNode('min'));

  const minIn = document.createElement('input');
  minIn.type = 'number';
  minIn.value = slider.min;
  minIn.addEventListener('change', () => { slider.min = minIn.value; param.rangeMin = parseFloat(minIn.value); });

  const maxIn = document.createElement('input');
  maxIn.type = 'number';
  maxIn.value = slider.max;
  maxIn.addEventListener('change', () => { slider.max = maxIn.value; param.rangeMax = parseFloat(maxIn.value); });

  const stepIn = document.createElement('input');
  stepIn.type = 'number';
  stepIn.value = slider.step;
  stepIn.addEventListener('change', () => {
    slider.step = stepIn.value;
    numInput.step = stepIn.value;
    param.rangeStep = parseFloat(stepIn.value);
  });

  rangeConf.appendChild(minIn);
  rangeConf.appendChild(document.createTextNode(' max'));
  rangeConf.appendChild(maxIn);
  rangeConf.appendChild(document.createTextNode(' step'));
  rangeConf.appendChild(stepIn);
  div.appendChild(rangeConf);

  return div;
}

function buildBooleanControl(param: ScadParam): HTMLElement {
  const wrap = document.createElement('div');
  wrap.className = 'toggle-wrapper';

  const label = document.createElement('label');
  label.className = 'toggle';

  const cb = document.createElement('input');
  cb.type = 'checkbox';
  cb.checked = param.currentValue === 'true';

  const sliderEl = document.createElement('span');
  sliderEl.className = 'toggle-slider';

  label.appendChild(cb);
  label.appendChild(sliderEl);

  const valSpan = document.createElement('span');
  valSpan.className = 'toggle-value';
  valSpan.textContent = param.currentValue;

  cb.addEventListener('change', () => {
    param.currentValue = cb.checked ? 'true' : 'false';
    valSpan.textContent = param.currentValue;
    onChange();
    highlightParamRow(param.name);
  });

  wrap.appendChild(label);
  wrap.appendChild(valSpan);
  return wrap;
}

function buildStringControl(param: ScadParam): HTMLElement {
  const input = document.createElement('input');
  input.type = 'text';
  input.value = param.currentValue.replace(/^["']|["']$/g, '');

  input.addEventListener('input', () => {
    param.currentValue = `"${input.value}"`;
    onChange();
    highlightParamRow(param.name);
  });

  return input;
}

function buildVectorControl(param: ScadParam): HTMLElement {
  const div = document.createElement('div');
  div.className = 'vector-inputs';

  const inner = param.currentValue.replace(/^\[|\]$/g, '');
  const parts = inner.split(',').map(s => s.trim());

  const inputs: HTMLInputElement[] = parts.map((val, idx) => {
    const inp = document.createElement('input');
    inp.type = 'number';
    inp.value = val;
    inp.placeholder = `[${idx}]`;
    inp.title = `Componente ${idx}`;

    inp.addEventListener('input', () => {
      const newParts = inputs.map(i => i.value || '0');
      param.currentValue = `[${newParts.join(', ')}]`;
      onChange();
      highlightParamRow(param.name);
    });

    div.appendChild(inp);
    return inp;
  });

  return div;
}

function buildTextFallback(param: ScadParam): HTMLElement {
  const input = document.createElement('input');
  input.type = 'text';
  input.value = param.currentValue;
  input.style.color = '#94a3b8';

  input.addEventListener('input', () => {
    param.currentValue = input.value;
    onChange();
    highlightParamRow(param.name);
  });

  return input;
}

function highlightParamRow(name: string) {
  const el = paramsList.querySelector(`[data-name="${name}"]`) as HTMLElement | null;
  if (!el) return;
  el.style.transition = 'background 0.1s';
  el.style.background = '#1e3a5f33';
  setTimeout(() => { el.style.background = ''; }, 600);
}

// ── Renderização do código ─────────────────────────────────────────────────
function renderCode() {
  if (!state) return;

  const changedNames = new Set(
    state.params.filter(p => p.currentValue !== p.originalValue).map(p => p.name)
  );

  if (currentTab === 'original') {
    codeOutput.innerHTML = highlightScad(state.lines.join('\n'), changedNames, false);
    return;
  }

  if (currentTab === 'diff') {
    codeOutput.innerHTML = renderDiff(state);
    return;
  }

  const modified = applyParams(state.lines, state.params);
  codeOutput.innerHTML = highlightScad(modified, changedNames, true);
}

function highlightScad(code: string, changedNames: Set<string>, markChanged: boolean): string {
  return code.split('\n').map(line => {
    const paramMatch = line.match(/^([a-zA-Z_][a-zA-Z0-9_]*)\s*=/);
    const isChanged = markChanged && paramMatch && changedNames.has(paramMatch[1]);
    const hl = colorize(line);
    return isChanged ? `<span class="tok-changed">${hl}</span>` : hl;
  }).join('\n');
}

function colorize(line: string): string {
  if (line.trimStart().startsWith('//')) {
    return `<span class="tok-comment">${esc(line)}</span>`;
  }
  return line.replace(
    /(\/\/.*$)|("(?:[^"\\]|\\.)*")|(\btrue\b|\bfalse\b)|(\b(?:module|function|if|else|for|let|include|use|echo)\b)|(\b\d+(?:\.\d+)?\b)|([a-zA-Z_][a-zA-Z0-9_]*(?=\s*=))/g,
    (match, comment, str, bool, keyword, number, param) => {
      if (comment) return `<span class="tok-comment">${esc(match)}</span>`;
      if (str)     return `<span class="tok-string">${esc(match)}</span>`;
      if (bool)    return `<span class="tok-bool">${esc(match)}</span>`;
      if (keyword) return `<span class="tok-keyword">${esc(match)}</span>`;
      if (number)  return `<span class="tok-number">${esc(match)}</span>`;
      if (param)   return `<span class="tok-param">${esc(match)}</span>`;
      return esc(match);
    }
  );
}

function renderDiff(s: ParseResult): string {
  const original = s.lines.join('\n').split('\n');
  const modified = applyParams(s.lines, s.params).split('\n');

  return original.map((origLine, i) => {
    const modLine = modified[i] ?? '';
    if (origLine === modLine) return `<span class="tok-plain">${esc(origLine)}</span>`;
    return [
      `<span style="color:#f87171;text-decoration:line-through;opacity:0.6">- ${esc(origLine)}</span>`,
      `<span style="color:#4ade80">+ ${esc(modLine)}</span>`,
    ].join('\n');
  }).join('\n');
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// ── Estatísticas ───────────────────────────────────────────────────────────
function updateStats() {
  if (!state) return;
  const changed = state.params.filter(p => p.currentValue !== p.originalValue).length;
  statParams.textContent = String(state.params.length);
  statLines.textContent = String(state.lines.length);
  statChanged.textContent = String(changed);
  statChanged.style.color = changed > 0 ? '#60a5fa' : '';
}
