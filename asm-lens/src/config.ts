import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';

const CONFIG_FILENAME = '.asm-lens.json';

export interface AsmLensConfig {
  binary: string;
  sourceRoot: string;
  objdump?: string;
  objdumpArgs?: string[];
  sections?: string[];
}

export function getConfigPath(): string | undefined {
  const folders = vscode.workspace.workspaceFolders;
  if (!folders || folders.length === 0) {
    return undefined;
  }
  return path.join(folders[0].uri.fsPath, CONFIG_FILENAME);
}

export async function loadConfig(): Promise<AsmLensConfig> {
  const configPath = getConfigPath();
  if (!configPath) {
    throw new Error('No workspace folder open');
  }

  if (!fs.existsSync(configPath)) {
    throw new Error(`Config file not found: ${CONFIG_FILENAME}. Run "ASM Lens: Initialize Config" to create one.`);
  }

  const raw = fs.readFileSync(configPath, 'utf-8');
  let parsed: any;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(`Invalid JSON in ${CONFIG_FILENAME}`);
  }

  if (!parsed.binary || typeof parsed.binary !== 'string') {
    throw new Error(`"binary" field is required in ${CONFIG_FILENAME}`);
  }

  const workspaceRoot = vscode.workspace.workspaceFolders![0].uri.fsPath;

  const config: AsmLensConfig = {
    binary: resolvePath(workspaceRoot, parsed.binary),
    sourceRoot: resolvePath(workspaceRoot, parsed.sourceRoot || '.'),
    objdump: parsed.objdump || undefined,
    objdumpArgs: Array.isArray(parsed.objdumpArgs) ? parsed.objdumpArgs : [],
    sections: Array.isArray(parsed.sections) ? parsed.sections : ['.text'],
  };

  if (!fs.existsSync(config.binary)) {
    throw new Error(`Binary not found: ${config.binary}`);
  }

  return config;
}

export async function initConfig(): Promise<void> {
  const configPath = getConfigPath();
  if (!configPath) {
    vscode.window.showErrorMessage('No workspace folder open.');
    return;
  }

  if (fs.existsSync(configPath)) {
    const overwrite = await vscode.window.showWarningMessage(
      `${CONFIG_FILENAME} already exists. Overwrite?`,
      'Yes', 'No'
    );
    if (overwrite !== 'Yes') {
      return;
    }
  }

  const binaryUri = await vscode.window.showOpenDialog({
    canSelectFiles: true,
    canSelectFolders: false,
    canSelectMany: false,
    title: 'Select compiled binary',
  });

  if (!binaryUri || binaryUri.length === 0) {
    return;
  }

  const workspaceRoot = vscode.workspace.workspaceFolders![0].uri.fsPath;
  const binaryRel = path.relative(workspaceRoot, binaryUri[0].fsPath);

  const config = {
    binary: `./${binaryRel.replace(/\\/g, '/')}`,
    sourceRoot: '.',
  };

  fs.writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n', 'utf-8');
  vscode.window.showInformationMessage(`Created ${CONFIG_FILENAME}`);
}

function resolvePath(workspaceRoot: string, p: string): string {
  if (path.isAbsolute(p)) {
    return p;
  }
  return path.resolve(workspaceRoot, p);
}
