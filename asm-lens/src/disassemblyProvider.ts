import { execFile } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs';
import { DetectedTool } from './toolDetector';

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
  extraArgs: string[]
): Promise<string> {
  const stat = fs.statSync(binaryPath);
  const mtime = stat.mtimeMs;

  const cached = cache.get(binaryPath);
  if (cached && cached.mtime === mtime) {
    return cached.output;
  }

  const args = buildArgs(tool, binaryPath, sections, extraArgs);
  const { stdout } = await execFileAsync(tool.path, args, {
    maxBuffer: 256 * 1024 * 1024,
    timeout: 120_000,
  });

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
  extraArgs: string[]
): string[] {
  const args: string[] = [];

  args.push('-d');

  if (tool.type === 'gnu') {
    args.push('-l');
    args.push('--no-show-raw-insn');
  } else {
    args.push('--line-numbers');
    args.push('--no-show-raw-insn');
  }

  for (const section of sections) {
    args.push('-j', section);
  }

  args.push(...extraArgs);
  args.push(binaryPath);

  return args;
}
