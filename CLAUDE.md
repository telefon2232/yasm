# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

YASM — VS Code extension that shows x86/x64 disassembly side-by-side with C/C++ source code using DWARF debug info from `objdump`. Godbolt-style color mapping with bidirectional navigation.

## Build Commands

```bash
npm run compile          # esbuild → bin/extension.js
npm run watch            # continuous build
npx vsce package --allow-missing-repository --out bin/yasm-0.1.0.vsix  # package VSIX
code --install-extension bin/yasm-0.1.0.vsix --force  # install extension
```

Debug: F5 in VS Code launches Extension Development Host.

No test framework configured — manual testing only via Extension Development Host.

## Architecture

Single-bundle VS Code extension. esbuild bundles all `src/*.ts` into `bin/extension.js`.

**Data flow (Show Assembly):**
```
config.ts (load .yasm.json)
  → toolDetector.ts (find GNU/LLVM objdump)
  → disassemblyProvider.ts (run objdump, cache by mtime)
  → objdumpParser.ts (parse → AsmFunction[])
  → sourceAsmMapper.ts (build source↔asm bidirectional maps, generate .asm text)
  → decorationManager.ts (12-color palette, hover highlighting)
```

**extension.ts** orchestrates everything: command registration, lifecycle, binary file watcher for auto-refresh, bidirectional selection events, status bar, diff mode.

**Diff mode** uses separate `DecorationManager` instances and `SourceAsmMapper` instances per asm editor. Two asm files open in ViewColumn.Two and ViewColumn.Three, both with color mapping to the source in ViewColumn.One. State is tracked via `diffMapper1/2`, `diffDecorations1/2`, `diffAsmEditor1/2`.

**Key types:** `AsmLensConfig` (config.ts), `DetectedTool`/`ObjdumpType` (toolDetector.ts), `AsmFunction`/`AsmLine` (objdumpParser.ts), `SourceLocation` (sourceAsmMapper.ts), `MappingEntry` (decorationManager.ts).

**Path normalization:** All paths converted to forward slashes + lowercase drive letters via `sourceAsmMapper.normalizePath()` for cross-platform consistency. DWARF line numbers are 1-based, editor lines are 0-based.

**Commands:** `yasm.showAssembly`, `yasm.refresh`, `yasm.initConfig`, `yasm.diffAssembly`. Config file: `.yasm.json`.

## Conventions

- Код простой, без лишних зависимостей. Runtime deps — только VS Code API.
- Документацию класть в `Docs/`, с кратким примером для быстрого запуска.
- Билд всегда в директорию `bin/`.
- Удалять пустые файлы и папки.
- Комментарии в коде — на русском (см. decorationManager.ts, extension.ts).
- Предпочитать стандартные библиотеки Node.js (`child_process`, `fs`, `path`, `os`).
