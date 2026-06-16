# SCAD Param Editor

Editor interativo de parâmetros para arquivos OpenSCAD, com visualização 3D em tempo real diretamente no navegador. Permite carregar um arquivo `.scad`, editar seus parâmetros via controles visuais (sliders, toggles, inputs) e ver o modelo 3D atualizar instantaneamente — sem precisar instalar o OpenSCAD.

---

## Demonstração

```
┌─────────────────┬──────────────────────┬───────────────────────┐
│   Parâmetros    │    Visualização 3D   │     Código Fonte      │
│                 │                      │                       │
│  width  ──●──   │   ┌────────────┐    │  width = 30;          │
│  height ───●─   │   │   [Cubo]   │    │  height = 20;  ← diff │
│  depth  ─●───   │   └────────────┘    │  depth = 15;          │
│                 │                      │                       │
└─────────────────┴──────────────────────┴───────────────────────┘
```

---

## Funcionalidades

- **Carregamento de arquivos `.scad`** via seletor de arquivo no navegador
- **Extração automática de parâmetros** — detecta todas as variáveis de nível raiz e seus tipos
- **Controles interativos por tipo:**
  - `number` → slider + input numérico (com range via comentário `// [min:max]`)
  - `boolean` → toggle switch
  - `string` → campo de texto
  - `vector` → inputs individuais por componente (ex: `[x, y, z]`)
- **Visualização 3D em tempo real** usando Three.js com suporte a:
  - Primitivos: `cube`, `sphere`, `cylinder`, `polyhedron`
  - Transformações: `translate`, `rotate`, `scale`, `mirror`, `resize`, `multmatrix`
  - Operações CSG: `union`, `difference`, `intersection`
  - Cor e opacidade: `color()`
  - Extrusão: `linear_extrude`
  - Loops e condicionais: `for`, `if/else`
  - Módulos e funções definidos pelo usuário
- **Syntax highlighting** do código OpenSCAD
- **Abas de código:** `Modificado` / `Original` / `Diff` (diferenças linha a linha)
- **Câmera 3D interativa:** rotação, zoom, pan via mouse; botão de reset e wireframe
- **Cópia do código modificado** para a área de transferência
- **Painel de estatísticas:** quantidade de parâmetros, linhas, alterações e avisos

---

## Como Usar

### 1. Instalar dependências

```bash
npm install
```

### 2. Iniciar o servidor de desenvolvimento

```bash
npm run dev
```

Acesse `http://localhost:5173` no navegador.

### 3. Carregar um arquivo `.scad`

Clique em **"Carregar arquivo .scad"** e selecione um arquivo. O projeto já inclui três exemplos:

| Arquivo | Descrição |
|---|---|
| `cube.scad` | Cubo simples com 3 parâmetros |
| `example.scad` | Caixa paramétrica com furos e materiais |
| `capa_celular.scad` | Case de celular com 28+ parâmetros |

### 4. Editar parâmetros

Ajuste os controles no painel esquerdo. O modelo 3D e o código atualizam em tempo real.

### 5. Exportar o código modificado

Clique em **"Copiar código"** na aba de código para copiar o `.scad` com os valores atuais.

---

## Definindo Ranges nos Arquivos `.scad`

Adicione comentários especiais após as variáveis para controlar os sliders:

```scad
width = 30;           // [5:200]        Largura sem step
height = 20;          // [1:0.5:50]     Altura com step de 0.5
chamfer = true;       // true/false     Booleano vira toggle
label = "teste";      // String vira campo de texto
pos = [0, 0, 10];     // Vetor vira 3 inputs
```

**Formato do range:** `// [min:max]` ou `// [min:step:max]`

O texto após o range (ou após o `;` sem range) vira o label do controle.

---

## Arquitetura

```
src/
├── main.ts          # Orquestração da UI, renderização de controles e abas
├── parser.ts        # Extrator de parâmetros do código fonte .scad
├── scad-parser.ts   # Tokenizador e parser de AST para OpenSCAD
├── scad-eval.ts     # Avaliador do AST → geometria Three.js
└── viewer.ts        # Componente de viewport 3D (Three.js + OrbitControls)

index.html           # Ponto de entrada, estilos embutidos, layout em grid
```

### Fluxo de dados

```
Arquivo .scad
     │
     ▼
parser.ts → ScadParam[]          Extrai variáveis e metadados
     │
     ▼
main.ts → Painel de controles    Renderiza sliders/toggles/inputs
     │
     │  (usuário edita)
     ▼
applyParams() → código modificado
     │
     ├──► renderCode()           Syntax highlighting + diff
     │
     └──► render3D()
               │
               ▼
         scad-parser.ts → AST   Tokeniza e constrói árvore sintática
               │
               ▼
         scad-eval.ts → THREE.Group   Avalia AST em geometria
               │
               ▼
         viewer.ts               Exibe no canvas WebGL
```

### Módulos em detalhe

**`parser.ts`**
Usa regex para encontrar atribuições de variáveis em nível raiz (ignora blocos de módulos/funções). Detecta o tipo pelo valor (`true`/`false` → boolean, `[...]` → vector, `"..."` → string, número → number). Extrai hints de range de comentários inline.

**`scad-parser.ts`**
Tokenizador manual + parser descendente recursivo que produz um AST tipado. Suporta toda a sintaxe de expressões do OpenSCAD incluindo operadores ternários, chamadas de função com argumentos nomeados e definições de módulos com filhos.

**`scad-eval.ts`**
Walk no AST que resolve variáveis em um environment de escopo léxico, avalia expressões matemáticas e despacha chamadas de módulos para implementações de primitivos e transformações Three.js. Usa `three-bvh-csg` para operações booleanas (union/difference/intersection). Converte coordenadas do sistema Z-up (OpenSCAD) para Y-up (Three.js).

**`viewer.ts`**
Encapsula o WebGL renderer, câmera perspectiva, OrbitControls, iluminação, grid e axes helpers. Expõe `setGeometry()` para trocar o modelo e `fitCamera()` para enquadrar automaticamente.

---

## Stack Tecnológica

| Tecnologia | Versão | Uso |
|---|---|---|
| TypeScript | 5.4 | Linguagem principal |
| Vite | 5.2 | Build tool e dev server |
| Three.js | 0.184 | Renderização 3D (WebGL) |
| three-bvh-csg | 0.0.18 | Operações CSG (union/difference/intersection) |
| three-mesh-bvh | 0.9.10 | BVH para aceleração de CSG |

---

## Build para Produção

```bash
npm run build
```

Os arquivos são gerados em `dist/`. O resultado é uma SPA estática que pode ser servida por qualquer servidor HTTP (GitHub Pages, Netlify, etc.).

---

## Limitações Conhecidas

- `hull()` e `minkowski()` têm implementações aproximadas
- `import()` e `use` não são suportados (sem acesso a sistema de arquivos)
- Recursão profunda em módulos pode causar stack overflow
- Geometrias muito complexas podem ser lentas por limitações do CSG em JS

