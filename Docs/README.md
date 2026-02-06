# ASM Lens

Коротко о структуре:
- `asm-lens/` — исходники расширения
- `asm-lens/bin/` — собранный бандл

Быстрый старт (Windows):
1) `cd asm-lens`
2) `npm install`
3) `npm run compile`
4) Откройте `asm-lens` в VS Code и запустите Extension Development Host (F5)

Минимальный `.asm-lens.json` для активации:
```json
{
  "compiler": "gcc",
  "sourceRoot": "."
}
```
