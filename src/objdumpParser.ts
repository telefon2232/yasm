import { ObjdumpType } from "./toolDetector";

export interface AsmLine {
  address: string;
  instruction: string;
  sourceFile?: string;
  sourceLine?: number;
}

export interface AsmFunction {
  name: string;
  startAddress: string;
  lines: AsmLine[];
}

// 0000000000401000 <main>:
const RE_FUNC = /^([0-9a-f]+)\s+<(.+)>:\s*$/;

// GNU:   401020:	mov    eax,[rbp-0x4]
// LLVM:  401020:       mov    eax, dword ptr [rbp - 4]
const RE_INSTR = /^\s*([0-9a-f]+):\s+(.+)$/;

// GNU source annotation:
//   /home/user/main.c:42           (Linux)
//   C:\Users\user\main.c:42       (Windows, MinGW)
//   C:/Users/user/main.c:42       (Windows, MSYS2)
// May have (discriminator N) suffix
const RE_SOURCE_GNU = /^(.+):(\d+)(?:\s+\(discriminator\s+\d+\))?\s*$/;

// LLVM source annotation: ; /home/user/main.c:42  or  ; C:\Users\main.c:42
const RE_SOURCE_LLVM = /^;\s+(.+):(\d+)\s*$/;

export function parseObjdumpOutput(
  raw: string,
  toolType: ObjdumpType,
): AsmFunction[] {
  const lines = raw.split(/\r?\n/);
  const reSource = toolType === "llvm" ? RE_SOURCE_LLVM : RE_SOURCE_GNU;
  const functions: AsmFunction[] = [];

  let currentFunc: AsmFunction | null = null;
  let currentFile: string | undefined;
  let currentLine: number | undefined;

  for (const line of lines) {
    const trimmed = line.trimEnd();

    // Function header
    const funcMatch = trimmed.match(RE_FUNC);
    if (funcMatch) {
      currentFunc = {
        name: funcMatch[2],
        startAddress: funcMatch[1],
        lines: [],
      };
      functions.push(currentFunc);
      currentFile = undefined;
      currentLine = undefined;
      continue;
    }

    // Source annotation — must check before instruction because
    // source lines don't start with whitespace+hex
    const sourceMatch = trimmed.match(reSource);
    if (sourceMatch) {
      const filePart = sourceMatch[1];
      const linePart = parseInt(sourceMatch[2], 10);
      // Validate: must look like a file path, not a hex instruction
      // Instructions look like "  401020:  mov ..." — the part before : is hex-only
      // File paths contain letters, slashes, dots, etc.
      if (!isInstructionLine(trimmed) && looksLikeFilePath(filePart)) {
        currentFile = filePart;
        currentLine = linePart;
        continue;
      }
    }

    // Instruction
    const instrMatch = trimmed.match(RE_INSTR);
    if (instrMatch && currentFunc) {
      currentFunc.lines.push({
        address: instrMatch[1],
        instruction: instrMatch[2].trimEnd(),
        sourceFile: currentFile,
        sourceLine: currentLine,
      });
      continue;
    }
  }

  return functions;
}

/** Check if line looks like an instruction (starts with optional whitespace + hex:) */
function isInstructionLine(line: string): boolean {
  return /^\s+[0-9a-f]+:\s/.test(line);
}

/** Check if a string looks like a file path rather than hex garbage */
function looksLikeFilePath(s: string): boolean {
  // Must contain a slash or backslash, or start with a drive letter
  return /[/\\]/.test(s) || /^[a-zA-Z]:/.test(s);
}
