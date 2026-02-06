import * as path from "path";
import { AsmFunction } from "./objdumpParser";

export interface SourceLocation {
  file: string;
  line: number;
}

/**
 * Normalize any path to forward slashes and lowercase drive letter for consistent matching.
 * "C:\Users\foo\main.c" → "c:/users/foo/main.c"
 */
function toUniform(p: string): string {
  let s = p.replace(/\\/g, "/");
  // Lowercase drive letter on Windows: C:/ → c:/
  if (/^[A-Z]:\//.test(s)) {
    s = s[0].toLowerCase() + s.slice(1);
  }
  return s;
}

export class SourceAsmMapper {
  // source "normalizedPath:line" → asm document line numbers (0-based)
  private sourceToAsm = new Map<string, number[]>();
  // asm document line number (0-based) → source location
  private asmToSource = new Map<number, SourceLocation>();
  // All unique normalized source keys for iteration
  private allKeys = new Set<string>();

  private sourceRoot: string;
  private sourceRootUniform: string;

  constructor(sourceRoot: string) {
    this.sourceRoot = sourceRoot;
    this.sourceRootUniform = toUniform(sourceRoot);
  }

  build(functions: AsmFunction[]): string {
    this.sourceToAsm.clear();
    this.asmToSource.clear();
    this.allKeys.clear();

    const outputLines: string[] = [];
    let asmLineNum = 0;

    for (const func of functions) {
      // Function header line
      outputLines.push(`<${func.name}>:`);
      asmLineNum++;

      for (const asmLine of func.lines) {
        const text = `  ${asmLine.address}:  ${asmLine.instruction}`;
        outputLines.push(text);

        if (asmLine.sourceFile && asmLine.sourceLine !== undefined) {
          const normFile = this.normalizePath(asmLine.sourceFile);
          const key = `${normFile}:${asmLine.sourceLine}`;

          // source → asm (0-based line numbers)
          let asmLines = this.sourceToAsm.get(key);
          if (!asmLines) {
            asmLines = [];
            this.sourceToAsm.set(key, asmLines);
          }
          asmLines.push(asmLineNum);
          this.allKeys.add(key);

          // asm → source
          this.asmToSource.set(asmLineNum, {
            file: normFile,
            line: asmLine.sourceLine,
          });
        }

        asmLineNum++;
      }

      // Blank line between functions
      outputLines.push("");
      asmLineNum++;
    }

    return outputLines.join("\n");
  }

  /**
   * Get asm line numbers for a given source file + line.
   * file: absolute path from editor (e.g. "C:\Users\foo\main.c")
   * line: 1-based DWARF line number
   */
  getAsmLinesForSource(file: string, line: number): number[] {
    const normFile = this.normalizePath(file);
    return this.sourceToAsm.get(`${normFile}:${line}`) || [];
  }

  getSourceForAsmLine(asmLine: number): SourceLocation | undefined {
    return this.asmToSource.get(asmLine);
  }

  /** Get all source keys that have asm mapping. */
  getAllSourceKeys(): Set<string> {
    return this.allKeys;
  }

  /** Get the raw sourceToAsm map for building color mapping. */
  getSourceToAsmMap(): Map<string, number[]> {
    return this.sourceToAsm;
  }

  resolveToWorkspace(normFile: string): string {
    if (path.isAbsolute(normFile)) {
      return normFile;
    }
    return path.join(this.sourceRoot, normFile);
  }

  /**
   * Normalize a file path: make relative to sourceRoot if possible,
   * using uniform forward-slash comparison.
   */
  normalizePath(p: string): string {
    const uni = toUniform(p);
    const root = this.sourceRootUniform.endsWith("/")
      ? this.sourceRootUniform
      : this.sourceRootUniform + "/";

    if (uni.startsWith(root)) {
      return uni.slice(root.length);
    }
    if (uni.startsWith(this.sourceRootUniform)) {
      return uni.slice(this.sourceRootUniform.length).replace(/^\//, "");
    }
    // Return uniform path even if not relative
    return uni;
  }
}
