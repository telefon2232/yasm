import * as vscode from "vscode";
import * as path from "path";
import * as fs from "fs";
import { loadConfig, initConfig, AsmLensConfig } from "./config";
import { detectObjdump } from "./toolDetector";
import { disassemble, invalidateCache } from "./disassemblyProvider";
import { parseObjdumpOutput } from "./objdumpParser";
import { SourceAsmMapper } from "./sourceAsmMapper";
import { DecorationManager, MappingEntry } from "./decorationManager";

let decorations: DecorationManager;
let mapper: SourceAsmMapper;
let asmEditor: vscode.TextEditor | undefined;
let currentConfig: AsmLensConfig | undefined;
let binaryWatcher: vscode.FileSystemWatcher | undefined;
let asmFilePath: string | undefined;

export function activate(context: vscode.ExtensionContext): void {
  decorations = new DecorationManager();

  context.subscriptions.push(decorations);

  context.subscriptions.push(
    vscode.commands.registerCommand("asm-lens.showAssembly", cmdShowAssembly),
    vscode.commands.registerCommand("asm-lens.refresh", cmdRefresh),
    vscode.commands.registerCommand("asm-lens.initConfig", initConfig),
  );

  // Bidirectional highlight on cursor move
  context.subscriptions.push(
    vscode.window.onDidChangeTextEditorSelection(onSelectionChanged),
  );

  // Track asm editor lifetime
  context.subscriptions.push(
    vscode.window.onDidChangeVisibleTextEditors((editors) => {
      if (asmEditor && !editors.find((e) => e === asmEditor)) {
        asmEditor = undefined;
      }
    }),
  );
}

export function deactivate(): void {
  binaryWatcher?.dispose();
}

async function cmdShowAssembly(): Promise<void> {
  try {
    await loadAndShow();
  } catch (err: any) {
    vscode.window.showErrorMessage(`ASM Lens: ${err.message}`);
  }
}

async function cmdRefresh(): Promise<void> {
  try {
    if (currentConfig) {
      invalidateCache(currentConfig.binary);
    }
    await loadAndShow();
  } catch (err: any) {
    vscode.window.showErrorMessage(`ASM Lens: ${err.message}`);
  }
}

async function loadAndShow(): Promise<void> {
  const config = await loadConfig();
  currentConfig = config;

  const tool = await detectObjdump(config.objdump);

  const statusMsg = vscode.window.setStatusBarMessage(
    "ASM Lens: Disassembling...",
  );
  let rawOutput: string;
  try {
    rawOutput = await disassemble(
      config.binary,
      tool,
      config.sections || [".text"],
      config.objdumpArgs || [],
    );
  } finally {
    statusMsg.dispose();
  }

  if (!rawOutput.trim()) {
    throw new Error(
      "objdump produced empty output. Is the binary compiled with -g?",
    );
  }

  const functions = parseObjdumpOutput(rawOutput, tool.type);
  if (functions.length === 0) {
    throw new Error("No functions found in disassembly output.");
  }

  mapper = new SourceAsmMapper(config.sourceRoot);
  const asmText = mapper.build(functions);

  // Save .asm file next to binary
  asmFilePath = config.binary.replace(/(\.[^.]+)?$/, ".asm");
  fs.writeFileSync(asmFilePath, asmText, "utf-8");

  // Open .asm file as a real file in editor
  const asmUri = vscode.Uri.file(asmFilePath);
  const doc = await vscode.workspace.openTextDocument(asmUri);
  asmEditor = await vscode.window.showTextDocument(doc, {
    viewColumn: vscode.ViewColumn.Beside,
    preserveFocus: true,
    preview: false,
  });

  // Apply color stripes
  applyColors();

  setupBinaryWatcher(config.binary);

  vscode.window.showInformationMessage(
    `ASM Lens: ${functions.length} functions → ${path.basename(asmFilePath)}`,
  );
}

/**
 * Build mapping entries directly from mapper data and apply color decorations.
 * Uses mapper.getSourceToAsmMap() which has keys like "main.c:5" (normalized relative paths).
 */
function applyColors(): void {
  const sourceEditor = findSourceEditor();
  if (!sourceEditor || !asmEditor || !mapper) return;

  const filePath = sourceEditor.document.uri.fsPath;
  const normFile = mapper.normalizePath(filePath);

  const sourceToAsm = mapper.getSourceToAsmMap();
  const entries: MappingEntry[] = [];

  for (const [key, asmLines] of sourceToAsm) {
    // key = "main.c:5" — extract file and line parts
    const lastColon = key.lastIndexOf(":");
    if (lastColon === -1) continue;

    const keyFile = key.substring(0, lastColon);
    const keyLine = parseInt(key.substring(lastColon + 1), 10);

    // Only include entries belonging to the current source file
    if (keyFile !== normFile) continue;

    entries.push({
      sourceKey: key,
      sourceLine: keyLine - 1, // DWARF 1-based → editor 0-based
      asmLines,
    });
  }

  decorations.applyColorMapping(sourceEditor, asmEditor, entries);
}

function setupBinaryWatcher(binaryPath: string): void {
  binaryWatcher?.dispose();

  const pattern = new vscode.RelativePattern(
    path.dirname(binaryPath),
    path.basename(binaryPath),
  );
  binaryWatcher = vscode.workspace.createFileSystemWatcher(pattern);

  binaryWatcher.onDidChange(() => {
    invalidateCache(binaryPath);
    loadAndShow().catch((err) => {
      vscode.window.showErrorMessage(`ASM Lens auto-refresh: ${err.message}`);
    });
  });
}

function onSelectionChanged(
  event: vscode.TextEditorSelectionChangeEvent,
): void {
  if (!mapper || !asmEditor) return;

  const editor = event.textEditor;
  const line = event.selections[0].active.line;

  // Check if this is the asm editor by file path
  if (asmFilePath && editor.document.uri.fsPath === asmFilePath) {
    handleAsmClick(line);
  } else if (isSourceEditor(editor)) {
    handleSourceClick(editor, line);
  }
}

function handleSourceClick(
  sourceEditor: vscode.TextEditor,
  line: number,
): void {
  if (!mapper || !asmEditor) return;

  const filePath = sourceEditor.document.uri.fsPath;
  const asmLines = mapper.getAsmLinesForSource(filePath, line + 1);

  if (asmLines.length > 0) {
    const normFile = mapper.normalizePath(filePath);
    const sourceKey = `${normFile}:${line + 1}`;
    decorations.highlightHover(
      sourceEditor,
      asmEditor,
      sourceKey,
      line,
      asmLines,
    );
    decorations.scrollTo(asmEditor, asmLines[0]);
  } else {
    decorations.clearHover(sourceEditor, asmEditor);
  }
}

function handleAsmClick(asmLine: number): void {
  if (!mapper || !asmEditor) return;

  const source = mapper.getSourceForAsmLine(asmLine);
  if (!source) {
    // Clicked on a line with no source mapping — clear hover
    const sourceEditor = findSourceEditor();
    if (sourceEditor) {
      decorations.clearHover(sourceEditor, asmEditor);
    }
    return;
  }

  const absPath = mapper.resolveToWorkspace(source.file);
  const sourceUri = vscode.Uri.file(absPath);

  const sourceEditor = vscode.window.visibleTextEditors.find(
    (e) => e.document.uri.fsPath === sourceUri.fsPath,
  );

  if (sourceEditor) {
    const editorLine = source.line - 1; // DWARF 1-based → 0-based
    const asmLines = mapper.getAsmLinesForSource(absPath, source.line);
    const sourceKey = `${source.file}:${source.line}`;

    decorations.highlightHover(
      sourceEditor,
      asmEditor!,
      sourceKey,
      editorLine,
      asmLines,
    );
    decorations.scrollTo(sourceEditor, editorLine);
  }
}

function findSourceEditor(): vscode.TextEditor | undefined {
  return vscode.window.visibleTextEditors.find((e) => isSourceEditor(e));
}

function isSourceEditor(editor: vscode.TextEditor): boolean {
  const langId = editor.document.languageId;
  return (
    editor.document.uri.scheme === "file" &&
    (langId === "c" ||
      langId === "cpp" ||
      langId === "objective-c" ||
      langId === "objective-cpp")
  );
}
