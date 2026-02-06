import * as vscode from "vscode";
import * as path from "path";
import * as fs from "fs";
import { loadConfig, getConfigPath, initConfig, AsmLensConfig } from "./config";
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
let statusBarItem: vscode.StatusBarItem;

export function activate(context: vscode.ExtensionContext): void {
  decorations = new DecorationManager();

  context.subscriptions.push(decorations);

  statusBarItem = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Left,
    100,
  );
  statusBarItem.command = "asm-lens.refresh";
  context.subscriptions.push(statusBarItem);

  context.subscriptions.push(
    vscode.commands.registerCommand("asm-lens.showAssembly", cmdShowAssembly),
    vscode.commands.registerCommand("asm-lens.refresh", cmdRefresh),
    vscode.commands.registerCommand("asm-lens.initConfig", initConfig),
    vscode.commands.registerCommand("asm-lens.diffAssembly", cmdDiffAssembly),
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
  statusBarItem?.hide();
}

function updateStatusBar(
  config: AsmLensConfig,
  funcCount: number,
  toolType: string,
): void {
  if (!statusBarItem) return;
  const binaryName = path.basename(config.binary);
  statusBarItem.text = `$(file-binary) ${binaryName} | ${funcCount} funcs | ${toolType}`;
  statusBarItem.tooltip = `ASM Lens: ${config.binary}\n${funcCount} functions, ${toolType} objdump\nClick to refresh`;
  statusBarItem.show();
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

async function cmdDiffAssembly(): Promise<void> {
  try {
    // Выбор первого бинарника
    const pick1 = await vscode.window.showOpenDialog({
      canSelectFiles: true,
      canSelectFolders: false,
      canSelectMany: false,
      title: "Select first binary (e.g. compiled with -O1)",
    });
    if (!pick1 || pick1.length === 0) return;

    // Выбор второго бинарника
    const pick2 = await vscode.window.showOpenDialog({
      canSelectFiles: true,
      canSelectFolders: false,
      canSelectMany: false,
      title: "Select second binary (e.g. compiled with -O2)",
    });
    if (!pick2 || pick2.length === 0) return;

    const binary1 = pick1[0].fsPath;
    const binary2 = pick2[0].fsPath;

    // Загружаем настройки из .asm-lens.json если есть
    let config: AsmLensConfig | undefined;
    const configPath = getConfigPath();
    if (configPath && fs.existsSync(configPath)) {
      try {
        config = await loadConfig();
      } catch {
        // конфиг невалидный — продолжаем с дефолтами
      }
    }

    const tool = await detectObjdump(config?.objdump);
    const sections = config?.sections || [".text"];
    const extraArgs = config?.objdumpArgs || [];

    const statusMsg = vscode.window.setStatusBarMessage("ASM Lens: Diffing...");
    try {
      // Дизассемблируем оба бинарника параллельно
      const [raw1, raw2] = await Promise.all([
        disassemble(binary1, tool, sections, extraArgs),
        disassemble(binary2, tool, sections, extraArgs),
      ]);

      const funcs1 = parseObjdumpOutput(raw1, tool.type);
      const funcs2 = parseObjdumpOutput(raw2, tool.type);

      const sourceRoot =
        config?.sourceRoot ||
        vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ||
        ".";
      const mapper1 = new SourceAsmMapper(sourceRoot);
      const mapper2 = new SourceAsmMapper(sourceRoot);
      const text1 = mapper1.build(funcs1);
      const text2 = mapper2.build(funcs2);

      // Сохраняем .asm файлы рядом с бинарниками
      const asmPath1 = binary1.replace(/(\.[^.]+)?$/, ".asm");
      const asmPath2 = binary2.replace(/(\.[^.]+)?$/, ".asm");
      fs.writeFileSync(asmPath1, text1, "utf-8");
      fs.writeFileSync(asmPath2, text2, "utf-8");

      // Открываем встроенный diff editor VS Code
      const uri1 = vscode.Uri.file(asmPath1);
      const uri2 = vscode.Uri.file(asmPath2);
      const title = `${path.basename(binary1)} vs ${path.basename(binary2)}`;
      await vscode.commands.executeCommand("vscode.diff", uri1, uri2, title);

      vscode.window.showInformationMessage(
        `ASM Lens Diff: ${funcs1.length} vs ${funcs2.length} functions`,
      );
    } finally {
      statusMsg.dispose();
    }
  } catch (err: any) {
    vscode.window.showErrorMessage(`ASM Lens Diff: ${err.message}`);
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

  updateStatusBar(config, functions.length, tool.type);

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
