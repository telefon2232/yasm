import { execFile, ChildProcess } from "child_process";
import { promisify } from "util";
import * as path from "path";
import * as os from "os";
import * as fs from "fs";
import * as crypto from "crypto";

const execFileAsync = promisify(execFile);

export interface CompileResult {
  success: boolean;
  outputPath: string;
  stderr: string;
}

/**
 * Компилирует исходный файл во временный .o.
 * compileCommand — шаблон с {file} и {output}.
 * Возвращает путь к .o и stderr (ошибки компилятора).
 */
export async function compileToObject(
  sourceFile: string,
  compileCommand: string,
  signal?: AbortSignal,
): Promise<CompileResult> {
  const hash = crypto
    .createHash("md5")
    .update(sourceFile)
    .digest("hex")
    .slice(0, 12);
  const baseName = path.basename(sourceFile, path.extname(sourceFile));
  const outputPath = path.join(os.tmpdir(), `yasm_${baseName}_${hash}.o`);

  // Подставляем {file} и {output} в команду
  const cmd = compileCommand
    .replace(/\{file\}/g, sourceFile)
    .replace(/\{output\}/g, outputPath);

  // Разбиваем команду на программу и аргументы
  const parts = parseCommand(cmd);
  if (parts.length === 0) {
    return { success: false, outputPath, stderr: "Empty compile command" };
  }

  const [program, ...args] = parts;

  try {
    const { stderr } = await execFileAsync(program, args, {
      timeout: 30_000,
      maxBuffer: 10 * 1024 * 1024,
      signal: signal as any,
    });

    const exists = fs.existsSync(outputPath);
    return {
      success: exists,
      outputPath,
      stderr: stderr || "",
    };
  } catch (err: any) {
    // Компиляция упала — возвращаем stderr с ошибками
    if (err.killed || err.code === "ABORT_ERR") {
      return { success: false, outputPath, stderr: "Compilation cancelled" };
    }
    return {
      success: false,
      outputPath,
      stderr: err.stderr || err.message || "Unknown compilation error",
    };
  }
}

/** Удаляет временный .o файл */
export function cleanupObjectFile(outputPath: string): void {
  try {
    if (fs.existsSync(outputPath)) {
      fs.unlinkSync(outputPath);
    }
  } catch {
    // не критично
  }
}

/**
 * Разбирает командную строку на массив аргументов.
 * Поддерживает кавычки: "gcc -O2 -g" → ["gcc", "-O2", "-g"]
 */
function parseCommand(cmd: string): string[] {
  const result: string[] = [];
  let current = "";
  let inQuote = false;
  let quoteChar = "";

  for (const ch of cmd) {
    if (inQuote) {
      if (ch === quoteChar) {
        inQuote = false;
      } else {
        current += ch;
      }
    } else if (ch === '"' || ch === "'") {
      inQuote = true;
      quoteChar = ch;
    } else if (ch === " " || ch === "\t") {
      if (current.length > 0) {
        result.push(current);
        current = "";
      }
    } else {
      current += ch;
    }
  }

  if (current.length > 0) {
    result.push(current);
  }

  return result;
}
