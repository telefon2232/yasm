import { execFile } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

export type ObjdumpType = 'gnu' | 'llvm';

export interface DetectedTool {
  path: string;
  type: ObjdumpType;
}

const CANDIDATES = ['objdump', 'llvm-objdump'];

export async function detectObjdump(configPath?: string): Promise<DetectedTool> {
  if (configPath) {
    const type = await detectType(configPath);
    return { path: configPath, type };
  }

  for (const candidate of CANDIDATES) {
    try {
      const type = await detectType(candidate);
      return { path: candidate, type };
    } catch {
      // not found, try next
    }
  }

  throw new Error(
    'objdump not found. Install binutils or LLVM, or set "objdump" in .asm-lens.json'
  );
}

async function detectType(toolPath: string): Promise<ObjdumpType> {
  const { stdout } = await execFileAsync(toolPath, ['--version'], { timeout: 5000 });
  if (stdout.toLowerCase().includes('llvm')) {
    return 'llvm';
  }
  return 'gnu';
}
