# ASM Lens — разработка

Структура:
- `src/` — исходники расширения (TypeScript)
- `bin/` — собранный бандл + .vsix
- `example/` — пример проекта из двух файлов

Быстрый старт:
```bash
cd asm-lens
npm install
npm run compile
```

Запуск в режиме разработки — F5 в VS Code (Extension Development Host).

Упаковка .vsix:
```bash
npx vsce package --allow-missing-repository --out bin/asm-lens-0.1.0.vsix
```
