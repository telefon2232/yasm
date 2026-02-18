# YASM — примеры

Три примера на разных языках, реализующие одну и ту же логику
(square, sum_squares). Позволяют сравнить генерируемый ассемблер
между языками.

## Быстрый старт

### 1. Установить расширение (если ещё не установлено)

```bash
code --install-extension ../bin/yasm-0.1.0.vsix
```

### 2. Выбрать пример и скомпилировать

| Язык    | Директория | Команда сборки                                  |
|---------|------------|-------------------------------------------------|
| C       | `c/`       | `gcc -g -O1 -o main main.c math_utils.c`       |
| Fortran | `fortran/` | `gfortran -g -O1 -o main main.f90 math_utils.f90` |
| Rust    | `rust/`    | `cargo build`                                   |

Флаг `-g` обязателен — без DWARF-отладки маппинг не работает.

### 3. Открыть папку примера в VS Code

```bash
cd c/        # или fortran/ или rust/
code .
```

### 4. Запустить

1. `Ctrl+Shift+P` → **YASM: Show Assembly**
2. Справа откроется панель с дизассемблером
3. Строки исходника и ассемблера окрашены в одинаковые цвета (матчинг)
4. Кликните на строку — соответствующие строки подсветятся ярче

## Структура

```
example/
├── README.md
├── c/                — пример на C (gcc)
│   ├── main.c
│   ├── math_utils.h
│   ├── math_utils.c
│   ├── .yasm.json
│   └── README.md
├── fortran/          — пример на Fortran (gfortran)
│   ├── main.f90
│   ├── math_utils.f90
│   ├── .yasm.json
│   └── README.md
└── rust/             — пример на Rust (cargo)
    ├── Cargo.toml
    ├── src/main.rs
    ├── .yasm.json
    └── README.md
```

## Конфиг .yasm.json

Каждая подпапка содержит свой `.yasm.json`:

```json
{
  "binary": "./main",
  "sourceRoot": ".",
  "objdump": "objdump",
  "objdumpArgs": ["-M", "intel"],
  "sections": [".text"]
}
```

- `binary` — путь до скомпилированного бинарника
- `sourceRoot` — корень исходников (для резолва путей из DWARF)
- `objdump` — путь к objdump/llvm-objdump (auto-detect по умолчанию)
- `objdumpArgs` — дополнительные аргументы (например `["-M", "intel"]` для Intel-синтаксиса)
- `sections` — секции для дизассемблирования (по умолчанию `.text`)
- `filterByFile` — показывать только функции из текущего открытого файла (полезно для больших бинарников и Remote SSH)
