import * as vscode from "vscode";
import * as path from "path";
import * as fs from "fs";
import * as os from "os";
import {
  loadConfig,
  getConfigPath,
  initConfig,
  AsmLensConfig,
  LiveModeConfig,
} from "./config";
import { detectObjdump, DetectedTool } from "./toolDetector";
import { disassemble, invalidateCache } from "./disassemblyProvider";
import { parseObjdumpOutput } from "./objdumpParser";
import { SourceAsmMapper } from "./sourceAsmMapper";
import { DecorationManager, MappingEntry } from "./decorationManager";
import { compileToObject, cleanupObjectFile } from "./liveCompiler";

let decorations: DecorationManager;
let mapper: SourceAsmMapper;
let asmEditor: vscode.TextEditor | undefined;
let currentConfig: AsmLensConfig | undefined;
let binaryWatcher: vscode.FileSystemWatcher | undefined;
let asmFilePath: string | undefined;
let statusBarItem: vscode.StatusBarItem;

// Diff mode state
let diffDecorations1: DecorationManager | undefined;
let diffDecorations2: DecorationManager | undefined;
let diffMapper1: SourceAsmMapper | undefined;
let diffMapper2: SourceAsmMapper | undefined;
let diffAsmEditor1: vscode.TextEditor | undefined;
let diffAsmEditor2: vscode.TextEditor | undefined;
let diffAsmPath1: string | undefined;
let diffAsmPath2: string | undefined;

// Live mode state
let liveActive = false;
let liveConfig: LiveModeConfig | undefined;
let liveTool: DetectedTool | undefined;
let liveSourceFile: string | undefined;
let liveObjectPath: string | undefined;
let liveMapper: SourceAsmMapper | undefined;
let liveDecorations: DecorationManager | undefined;
let liveAsmEditor: vscode.TextEditor | undefined;
let liveAsmPath: string | undefined;
let liveTimer: ReturnType<typeof setInterval> | undefined;
let liveSaveDisposable: vscode.Disposable | undefined;
let liveAbortController: AbortController | undefined;
let liveRefreshing = false;
let liveOutputChannel: vscode.OutputChannel | undefined;
let liveSections: string[] = [".text"];
let liveExtraArgs: string[] = [];
let liveSourceRoot: string = ".";

export function activate(context: vscode.ExtensionContext): void {
  decorations = new DecorationManager();

  context.subscriptions.push(decorations);

  statusBarItem = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Left,
    100,
  );
  statusBarItem.command = "yasm.refresh";
  context.subscriptions.push(statusBarItem);

  context.subscriptions.push(
    vscode.commands.registerCommand("yasm.showAssembly", cmdShowAssembly),
    vscode.commands.registerCommand("yasm.refresh", cmdRefresh),
    vscode.commands.registerCommand("yasm.initConfig", initConfig),
    vscode.commands.registerCommand("yasm.diffAssembly", cmdDiffAssembly),
    vscode.commands.registerCommand("yasm.liveMode", cmdLiveMode),
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
      if (liveAsmEditor && !editors.find((e) => e === liveAsmEditor)) {
        // Live asm editor closed — stop live mode
        stopLiveMode();
      }
    }),
  );
}

export function deactivate(): void {
  binaryWatcher?.dispose();
  statusBarItem?.hide();
  stopLiveMode();
}

function updateStatusBar(
  config: AsmLensConfig,
  funcCount: number,
  toolType: string,
): void {
  if (!statusBarItem) return;
  const binaryName = path.basename(config.binary);
  statusBarItem.text = `$(file-binary) ${binaryName} | ${funcCount} funcs | ${toolType}`;
  statusBarItem.tooltip = `YASM: ${config.binary}\n${funcCount} functions, ${toolType} objdump\nClick to refresh`;
  statusBarItem.show();
}

async function cmdShowAssembly(): Promise<void> {
  try {
    await loadAndShow();
  } catch (err: any) {
    vscode.window.showErrorMessage(`YASM: ${err.message}`);
  }
}

async function cmdRefresh(): Promise<void> {
  try {
    if (currentConfig) {
      invalidateCache(currentConfig.binary);
    }
    await loadAndShow();
  } catch (err: any) {
    vscode.window.showErrorMessage(`YASM: ${err.message}`);
  }
}

async function cmdDiffAssembly(): Promise<void> {
  try {
    // Select first binary
    const pick1 = await vscode.window.showOpenDialog({
      canSelectFiles: true,
      canSelectFolders: false,
      canSelectMany: false,
      title: "Select first binary (e.g. compiled with -O1)",
    });
    if (!pick1 || pick1.length === 0) return;

    // Select second binary
    const pick2 = await vscode.window.showOpenDialog({
      canSelectFiles: true,
      canSelectFolders: false,
      canSelectMany: false,
      title: "Select second binary (e.g. compiled with -O2)",
    });
    if (!pick2 || pick2.length === 0) return;

    const binary1 = pick1[0].fsPath;
    const binary2 = pick2[0].fsPath;

    // Load settings from .yasm.json if available
    let config: AsmLensConfig | undefined;
    const configPath = getConfigPath();
    if (configPath && fs.existsSync(configPath)) {
      try {
        config = await loadConfig();
      } catch (err: any) {
        vscode.window.showWarningMessage(
          `YASM Diff: config error (${err?.message || "unknown"}), using defaults`,
        );
      }
    }

    const tool = await detectObjdump(config?.objdump);
    const sections = config?.sections || [".text"];
    const extraArgs = config?.objdumpArgs || [];

    const statusMsg = vscode.window.setStatusBarMessage("YASM: Diffing...");
    try {
      // Disassemble both binaries in parallel
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

      // Create mappers and generate asm text
      diffMapper1 = new SourceAsmMapper(sourceRoot);
      diffMapper2 = new SourceAsmMapper(sourceRoot);
      const text1 = diffMapper1.build(funcs1);
      const text2 = diffMapper2.build(funcs2);

      // Save .asm files to temp with unique names
      const tmpDir = os.tmpdir();
      const name1 = path.basename(binary1);
      const name2 = path.basename(binary2);
      diffAsmPath1 = path.join(tmpDir, `${name1}_left.asm`);
      diffAsmPath2 = path.join(tmpDir, `${name2}_right.asm`);
      fs.writeFileSync(diffAsmPath1, text1, "utf-8");
      fs.writeFileSync(diffAsmPath2, text2, "utf-8");

      // Clear previous diff decorations
      diffDecorations1?.dispose();
      diffDecorations2?.dispose();
      diffDecorations1 = new DecorationManager();
      diffDecorations2 = new DecorationManager();

      // Open first asm to the right of the source
      const doc1 = await vscode.workspace.openTextDocument(
        vscode.Uri.file(diffAsmPath1),
      );
      diffAsmEditor1 = await vscode.window.showTextDocument(doc1, {
        viewColumn: vscode.ViewColumn.Two,
        preserveFocus: true,
        preview: false,
      });

      // Open second asm further to the right
      const doc2 = await vscode.workspace.openTextDocument(
        vscode.Uri.file(diffAsmPath2),
      );
      diffAsmEditor2 = await vscode.window.showTextDocument(doc2, {
        viewColumn: vscode.ViewColumn.Three,
        preserveFocus: true,
        preview: false,
      });

      // Apply color mapping to both asm editors
      applyDiffColors();

      vscode.window.showInformationMessage(
        `YASM Diff: ${name1} (${funcs1.length} funcs) vs ${name2} (${funcs2.length} funcs)`,
      );
    } finally {
      statusMsg.dispose();
    }
  } catch (err: any) {
    vscode.window.showErrorMessage(`YASM Diff: ${err.message}`);
  }
}

/** Applies source↔asm color mapping for both diff editors */
function applyDiffColors(): void {
  const sourceEditor = findSourceEditor();
  if (!sourceEditor) return;

  const filePath = sourceEditor.document.uri.fsPath;

  if (diffMapper1 && diffAsmEditor1 && diffDecorations1) {
    const entries = buildMappingEntries(diffMapper1, filePath);
    diffDecorations1.applyColorMapping(sourceEditor, diffAsmEditor1, entries);
  }

  if (diffMapper2 && diffAsmEditor2 && diffDecorations2) {
    const entries = buildMappingEntries(diffMapper2, filePath);
    diffDecorations2.applyColorMapping(sourceEditor, diffAsmEditor2, entries);
  }
}

/** Builds MappingEntry[] from a mapper for a specific source file */
function buildMappingEntries(
  m: SourceAsmMapper,
  filePath: string,
): MappingEntry[] {
  const normFile = m.normalizePath(filePath);
  const sourceToAsm = m.getSourceToAsmMap();
  const entries: MappingEntry[] = [];

  for (const [key, asmLines] of sourceToAsm) {
    const lastColon = key.lastIndexOf(":");
    if (lastColon === -1) continue;

    const keyFile = key.substring(0, lastColon);
    const keyLine = parseInt(key.substring(lastColon + 1), 10);

    if (keyFile !== normFile) continue;

    entries.push({
      sourceKey: key,
      sourceLine: keyLine - 1,
      asmLines,
    });
  }

  return entries;
}

async function loadAndShow(): Promise<void> {
  const config = await loadConfig();
  currentConfig = config;

  const tool = await detectObjdump(config.objdump);

  const statusMsg = vscode.window.setStatusBarMessage("YASM: Disassembling...");
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
    `YASM: ${functions.length} functions → ${path.basename(asmFilePath)}`,
  );
}

function applyColors(): void {
  const sourceEditor = findSourceEditor();
  if (!sourceEditor || !asmEditor || !mapper) return;

  const entries = buildMappingEntries(mapper, sourceEditor.document.uri.fsPath);
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
      vscode.window.showErrorMessage(
        `YASM auto-refresh: ${err?.message || String(err)}`,
      );
    });
  });
}

function onSelectionChanged(
  event: vscode.TextEditorSelectionChangeEvent,
): void {
  const editor = event.textEditor;
  const line = event.selections[0].active.line;
  const editorPath = editor.document.uri.fsPath;

  // Main asm editor
  if (mapper && asmEditor) {
    if (asmFilePath && editorPath === asmFilePath) {
      handleAsmClick(line);
      return;
    }
  }

  // Diff asm editors
  if (diffAsmPath1 && editorPath === diffAsmPath1 && diffMapper1) {
    handleDiffAsmClick(diffMapper1, diffDecorations1, diffAsmEditor1, line);
    return;
  }
  if (diffAsmPath2 && editorPath === diffAsmPath2 && diffMapper2) {
    handleDiffAsmClick(diffMapper2, diffDecorations2, diffAsmEditor2, line);
    return;
  }

  // Live mode asm editor
  if (liveAsmPath && editorPath === liveAsmPath && liveMapper) {
    handleDiffAsmClick(liveMapper, liveDecorations, liveAsmEditor, line);
    return;
  }

  // Source file — update all active mappings
  if (isSourceEditor(editor)) {
    if (mapper && asmEditor) {
      handleSourceClick(editor, line);
    }
    if (diffMapper1 && diffAsmEditor1 && diffDecorations1) {
      handleDiffSourceClick(
        editor,
        line,
        diffMapper1,
        diffDecorations1,
        diffAsmEditor1,
      );
    }
    if (diffMapper2 && diffAsmEditor2 && diffDecorations2) {
      handleDiffSourceClick(
        editor,
        line,
        diffMapper2,
        diffDecorations2,
        diffAsmEditor2,
      );
    }
    if (liveMapper && liveAsmEditor && liveDecorations) {
      handleDiffSourceClick(
        editor,
        line,
        liveMapper,
        liveDecorations,
        liveAsmEditor,
      );
    }
  }
}

function handleDiffSourceClick(
  sourceEditor: vscode.TextEditor,
  line: number,
  m: SourceAsmMapper,
  dec: DecorationManager,
  asmEd: vscode.TextEditor,
): void {
  const filePath = sourceEditor.document.uri.fsPath;
  const asmLines = m.getAsmLinesForSource(filePath, line + 1);

  if (asmLines.length > 0) {
    const normFile = m.normalizePath(filePath);
    const sourceKey = `${normFile}:${line + 1}`;
    dec.highlightHover(sourceEditor, asmEd, sourceKey, line, asmLines);
    dec.scrollTo(asmEd, asmLines[0]);
  } else {
    dec.clearHover(sourceEditor, asmEd);
  }
}

function handleDiffAsmClick(
  m: SourceAsmMapper,
  dec: DecorationManager | undefined,
  asmEd: vscode.TextEditor | undefined,
  asmLine: number,
): void {
  if (!dec || !asmEd) return;

  const source = m.getSourceForAsmLine(asmLine);
  const sourceEditor = findSourceEditor();

  if (!source || !sourceEditor) {
    if (sourceEditor) dec.clearHover(sourceEditor, asmEd);
    return;
  }

  const absPath = m.resolveToWorkspace(source.file);
  const editorLine = source.line - 1;
  const asmLines = m.getAsmLinesForSource(absPath, source.line);
  const sourceKey = `${source.file}:${source.line}`;

  dec.highlightHover(sourceEditor, asmEd, sourceKey, editorLine, asmLines);
  dec.scrollTo(sourceEditor, editorLine);
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

// ─── Live Mode ───────────────────────────────────────────────

async function cmdLiveMode(): Promise<void> {
  try {
    // If live mode is already active — stop it
    if (liveActive) {
      stopLiveMode();
      statusBarItem?.hide();
      vscode.window.showInformationMessage("YASM: Live mode stopped");
      return;
    }

    // Find the active source editor
    const sourceEditor = findSourceEditor();
    if (!sourceEditor) {
      vscode.window.showErrorMessage("YASM: Open a C/C++ source file first");
      return;
    }

    // Load config
    const config = await loadConfig();
    if (!config.liveMode) {
      vscode.window.showErrorMessage(
        'YASM: "liveMode" section not found in .yasm.json. Add compileCommand, trigger, etc.',
      );
      return;
    }

    liveConfig = config.liveMode;
    liveTool = await detectObjdump(config.objdump);
    liveSections = config.sections || [".text"];
    liveExtraArgs = config.objdumpArgs || [];
    liveSourceRoot = config.sourceRoot;
    liveSourceFile = sourceEditor.document.uri.fsPath;
    liveActive = true;

    // Output channel for compilation errors
    if (!liveOutputChannel) {
      liveOutputChannel = vscode.window.createOutputChannel("YASM Live");
    }
    liveOutputChannel.clear();

    // Create DecorationManager for live mode
    liveDecorations?.dispose();
    liveDecorations = new DecorationManager();

    // Initial run
    await liveRefresh();

    // Set up the trigger
    if (liveConfig.trigger === "live") {
      const interval = liveConfig.interval || 500;
      let lastContent = sourceEditor.document.getText();

      liveTimer = setInterval(() => {
        const editor = findSourceEditorByPath(liveSourceFile!);
        if (!editor) return;

        const currentContent = editor.document.getText();
        if (currentContent !== lastContent) {
          lastContent = currentContent;
          // Save file before compilation (compiler reads from disk)
          editor.document.save().then(() => {
            liveRefresh().catch((err) => showLiveError(err));
          });
        }
      }, interval);
    } else {
      // trigger === "save"
      liveSaveDisposable = vscode.workspace.onDidSaveTextDocument((doc) => {
        if (liveSourceFile && doc.uri.fsPath === liveSourceFile) {
          liveRefresh().catch((err) => showLiveError(err));
        }
      });
    }

    const triggerLabel =
      liveConfig.trigger === "live"
        ? `live (${liveConfig.interval || 500}ms)`
        : "on save";
    vscode.window.showInformationMessage(
      `YASM: Live mode started [${triggerLabel}]`,
    );
    updateLiveStatusBar(triggerLabel);
  } catch (err: any) {
    vscode.window.showErrorMessage(`YASM Live: ${err.message}`);
  }
}

async function liveRefresh(): Promise<void> {
  if (!liveActive || !liveConfig || !liveTool || !liveSourceFile) return;
  if (liveRefreshing) return; // previous refresh still in progress

  liveRefreshing = true;

  // Cancel previous compilation if it's still running
  liveAbortController?.abort();
  liveAbortController = new AbortController();

  try {
    // 1. Compile source into .o
    const result = await compileToObject(
      liveSourceFile,
      liveConfig.compileCommand,
      liveAbortController.signal,
    );

    if (!result.success) {
      // Show compilation errors in Output Channel
      if (liveOutputChannel && result.stderr !== "Compilation cancelled") {
        liveOutputChannel.clear();
        liveOutputChannel.appendLine("── Compilation errors ──");
        liveOutputChannel.appendLine(result.stderr);
        liveOutputChannel.show(true); // true = don't focus
      }
      statusBarItem.text = "$(error) YASM Live: compile error";
      return;
    }

    // Compilation succeeded — clear Output Channel
    liveOutputChannel?.clear();

    // Remember path for cleanup
    if (liveObjectPath && liveObjectPath !== result.outputPath) {
      cleanupObjectFile(liveObjectPath);
    }
    liveObjectPath = result.outputPath;

    // 2. Disassemble .o
    invalidateCache(result.outputPath);
    const rawOutput = await disassemble(
      result.outputPath,
      liveTool,
      liveSections,
      liveExtraArgs,
    );

    if (!rawOutput.trim()) return;

    // 3. Parse
    const functions = parseObjdumpOutput(rawOutput, liveTool.type);
    if (functions.length === 0) return;

    // 4. Build mapping and text
    liveMapper = new SourceAsmMapper(liveSourceRoot);
    const asmText = liveMapper.build(functions);

    // 5. Write .asm file to temp directory
    const baseName = path.basename(
      liveSourceFile,
      path.extname(liveSourceFile),
    );
    const tmpAsmPath = path.join(os.tmpdir(), `yasm_live_${baseName}.asm`);

    fs.writeFileSync(tmpAsmPath, asmText, "utf-8");
    liveAsmPath = tmpAsmPath;

    // 6. Open or update asm editor
    if (liveAsmEditor) {
      // Document already open — update contents via revert
      // (file already overwritten on disk, just re-read it)
      const doc = liveAsmEditor.document;
      if (doc.uri.fsPath === tmpAsmPath) {
        // Re-read file from disk
        await vscode.commands.executeCommand(
          "workbench.action.files.revert",
          doc.uri,
        );
        // After revert we need to re-acquire the editor
        liveAsmEditor = vscode.window.visibleTextEditors.find(
          (e) => e.document.uri.fsPath === tmpAsmPath,
        );
      }
    }

    if (!liveAsmEditor) {
      const doc = await vscode.workspace.openTextDocument(
        vscode.Uri.file(tmpAsmPath),
      );
      liveAsmEditor = await vscode.window.showTextDocument(doc, {
        viewColumn: vscode.ViewColumn.Beside,
        preserveFocus: true,
        preview: false,
      });
    }

    // 7. Apply color mapping
    const sourceEditor = findSourceEditorByPath(liveSourceFile);
    if (sourceEditor && liveAsmEditor && liveDecorations && liveMapper) {
      const entries = buildMappingEntries(liveMapper, liveSourceFile);
      liveDecorations.applyColorMapping(sourceEditor, liveAsmEditor, entries);
    }

    const triggerLabel =
      liveConfig.trigger === "live"
        ? `live (${liveConfig.interval || 500}ms)`
        : "on save";
    updateLiveStatusBar(triggerLabel, functions.length);
  } finally {
    liveRefreshing = false;
  }
}

function updateLiveStatusBar(triggerLabel: string, funcCount?: number): void {
  if (!statusBarItem) return;
  const funcs = funcCount !== undefined ? ` | ${funcCount} funcs` : "";
  statusBarItem.text = `$(zap) YASM Live [${triggerLabel}]${funcs}`;
  statusBarItem.tooltip = `YASM Live Mode\nSource: ${liveSourceFile}\nTrigger: ${triggerLabel}\nClick to refresh`;
  statusBarItem.show();
}

function stopLiveMode(): void {
  if (!liveActive) return;
  liveActive = false;

  if (liveTimer) {
    clearInterval(liveTimer);
    liveTimer = undefined;
  }

  liveSaveDisposable?.dispose();
  liveSaveDisposable = undefined;

  liveAbortController?.abort();
  liveAbortController = undefined;

  liveDecorations?.dispose();
  liveDecorations = undefined;

  liveMapper = undefined;
  liveAsmEditor = undefined;
  liveConfig = undefined;
  liveTool = undefined;
  liveSourceFile = undefined;
  liveAsmPath = undefined;
  liveRefreshing = false;

  // Remove temporary .o file
  if (liveObjectPath) {
    cleanupObjectFile(liveObjectPath);
    liveObjectPath = undefined;
  }
}

function showLiveError(err: any): void {
  const msg = err?.message || String(err);
  if (liveOutputChannel) {
    liveOutputChannel.appendLine(`── Live refresh error ──`);
    liveOutputChannel.appendLine(msg);
    liveOutputChannel.show(true);
  }
  if (statusBarItem) {
    statusBarItem.text = "$(error) YASM Live: error";
  }
}

function findSourceEditorByPath(
  filePath: string,
): vscode.TextEditor | undefined {
  return vscode.window.visibleTextEditors.find(
    (e) => e.document.uri.fsPath === filePath,
  );
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
      langId === "objective-cpp" ||
      langId === "fortran" ||
      langId === "FortranFreeForm" ||
      langId === "FortranFixedForm" ||
      langId === "rust")
  );
}
