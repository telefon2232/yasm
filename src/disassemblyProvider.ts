import { execFile } from "child_process";
import { promisify } from "util";
import * as fs from "fs";
import { DetectedTool } from "./toolDetector";

const execFileAsync = promisify(execFile);

interface CacheEntry {
  mtime: number;
  output: string;
}

const cache = new Map<string, CacheEntry>();

export async function disassemble(
  binaryPath: string,
  tool: DetectedTool,
  sections: string[],
  extraArgs: string[],
): Promise<string> {
  // Check that the binary exists
  let mtime: number;
  try {
    const stat = fs.statSync(binaryPath);
    mtime = stat.mtimeMs;
  } catch (err: any) {
    if (err?.code === "ENOENT") {
      throw new Error(
        `Binary file not found: ${binaryPath}. Was it deleted or moved?`,
      );
    }
    throw new Error(
      `Cannot access binary file: ${binaryPath} (${err?.message || err})`,
    );
  }

  const cached = cache.get(binaryPath);
  if (cached && cached.mtime === mtime) {
    return cached.output;
  }

  const args = buildArgs(tool, binaryPath, sections, extraArgs);

  let stdout: string;
  try {
    const result = await execFileAsync(tool.path, args, {
      maxBuffer: 5 * 1024 * 1024 * 1024,
      timeout: 120_000,
    });
    stdout = result.stdout;
  } catch (err: any) {
    if (err?.killed && err?.signal === "SIGTERM") {
      throw new Error(
        `objdump timed out (>120s). Binary may be too large, try limiting sections in .yasm.json`,
      );
    }
    if (err?.code === "ERR_CHILD_PROCESS_STDIO_MAXBUFFER") {
      throw new Error(
        `objdump output too large (>5GB). Try limiting sections in .yasm.json`,
      );
    }
    const stderr = (err?.stderr || "").slice(0, 300);
    const code = err?.code ?? err?.status ?? "unknown";
    throw new Error(
      `objdump failed (exit code ${code}): ${stderr || err?.message || "unknown error"}`,
    );
  }

  cache.set(binaryPath, { mtime, output: stdout });
  return stdout;
}

export function invalidateCache(binaryPath?: string): void {
  if (binaryPath) {
    cache.delete(binaryPath);
  } else {
    cache.clear();
  }
}

function buildArgs(
  tool: DetectedTool,
  binaryPath: string,
  sections: string[],
  extraArgs: string[],
): string[] {
  const args: string[] = [];

  args.push("-d");

  if (tool.type === "gnu") {
    args.push("-l");
    args.push("--no-show-raw-insn");
  } else {
    args.push("--line-numbers");
    args.push("--no-show-raw-insn");
  }

  for (const section of sections) {
    args.push("-j", section);
  }

  args.push(...extraArgs);
  args.push(binaryPath);

  return args;
}
