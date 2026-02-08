"use strict";
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/extension.ts
var extension_exports = {};
__export(extension_exports, {
  activate: () => activate,
  deactivate: () => deactivate
});
module.exports = __toCommonJS(extension_exports);
var vscode3 = __toESM(require("vscode"));
var path4 = __toESM(require("path"));
var fs4 = __toESM(require("fs"));
var os2 = __toESM(require("os"));

// src/config.ts
var vscode = __toESM(require("vscode"));
var path = __toESM(require("path"));
var fs = __toESM(require("fs"));
var CONFIG_FILENAME = ".yasm.json";
function getConfigPath() {
  const folders = vscode.workspace.workspaceFolders;
  if (!folders || folders.length === 0) {
    return void 0;
  }
  return path.join(folders[0].uri.fsPath, CONFIG_FILENAME);
}
async function loadConfig() {
  const configPath = getConfigPath();
  if (!configPath) {
    throw new Error("No workspace folder open");
  }
  if (!fs.existsSync(configPath)) {
    throw new Error(
      `Config file not found: ${CONFIG_FILENAME}. Run "ASM Lens: Initialize Config" to create one.`
    );
  }
  const raw = fs.readFileSync(configPath, "utf-8");
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(`Invalid JSON in ${CONFIG_FILENAME}`);
  }
  if (!parsed.binary || typeof parsed.binary !== "string") {
    throw new Error(`"binary" field is required in ${CONFIG_FILENAME}`);
  }
  const workspaceRoot = vscode.workspace.workspaceFolders[0].uri.fsPath;
  let liveMode;
  if (parsed.liveMode && typeof parsed.liveMode === "object") {
    const lm = parsed.liveMode;
    if (!lm.compileCommand || typeof lm.compileCommand !== "string") {
      throw new Error(
        `"liveMode.compileCommand" is required when liveMode is specified in ${CONFIG_FILENAME}`
      );
    }
    const trigger = lm.trigger === "live" ? "live" : "save";
    liveMode = {
      compileCommand: lm.compileCommand,
      trigger,
      interval: typeof lm.interval === "number" && lm.interval > 0 ? lm.interval : 500
    };
  }
  const config = {
    binary: resolvePath(workspaceRoot, parsed.binary),
    sourceRoot: resolvePath(workspaceRoot, parsed.sourceRoot || "."),
    objdump: parsed.objdump || void 0,
    objdumpArgs: Array.isArray(parsed.objdumpArgs) ? parsed.objdumpArgs : [],
    sections: Array.isArray(parsed.sections) ? parsed.sections : [".text"],
    liveMode
  };
  if (!fs.existsSync(config.binary)) {
    throw new Error(`Binary not found: ${config.binary}`);
  }
  return config;
}
async function initConfig() {
  const configPath = getConfigPath();
  if (!configPath) {
    vscode.window.showErrorMessage("No workspace folder open.");
    return;
  }
  if (fs.existsSync(configPath)) {
    const overwrite = await vscode.window.showWarningMessage(
      `${CONFIG_FILENAME} already exists. Overwrite?`,
      "Yes",
      "No"
    );
    if (overwrite !== "Yes") {
      return;
    }
  }
  const binaryUri = await vscode.window.showOpenDialog({
    canSelectFiles: true,
    canSelectFolders: false,
    canSelectMany: false,
    title: "Select compiled binary"
  });
  if (!binaryUri || binaryUri.length === 0) {
    return;
  }
  const workspaceRoot = vscode.workspace.workspaceFolders[0].uri.fsPath;
  const binaryRel = path.relative(workspaceRoot, binaryUri[0].fsPath);
  const config = {
    binary: `./${binaryRel.replace(/\\/g, "/")}`,
    sourceRoot: ".",
    objdump: "objdump",
    objdumpArgs: ["-M", "intel"],
    sections: [".text"],
    liveMode: {
      compileCommand: "gcc -g -O2 -c {file} -o {output}",
      trigger: "save",
      interval: 500
    }
  };
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2) + "\n", "utf-8");
  vscode.window.showInformationMessage(`Created ${CONFIG_FILENAME}`);
}
function resolvePath(workspaceRoot, p) {
  if (path.isAbsolute(p)) {
    return p;
  }
  return path.resolve(workspaceRoot, p);
}

// src/toolDetector.ts
var import_child_process = require("child_process");
var import_util = require("util");
var execFileAsync = (0, import_util.promisify)(import_child_process.execFile);
var CANDIDATES = ["objdump", "llvm-objdump"];
async function detectObjdump(configPath) {
  if (configPath) {
    const type = await detectType(configPath);
    return { path: configPath, type };
  }
  for (const candidate of CANDIDATES) {
    try {
      const type = await detectType(candidate);
      return { path: candidate, type };
    } catch {
    }
  }
  throw new Error(
    'objdump not found. Install binutils or LLVM, or set "objdump" in .asm-lens.json'
  );
}
async function detectType(toolPath) {
  const { stdout } = await execFileAsync(toolPath, ["--version"], { timeout: 5e3 });
  if (stdout.toLowerCase().includes("llvm")) {
    return "llvm";
  }
  return "gnu";
}

// src/disassemblyProvider.ts
var import_child_process2 = require("child_process");
var import_util2 = require("util");
var fs2 = __toESM(require("fs"));
var execFileAsync2 = (0, import_util2.promisify)(import_child_process2.execFile);
var cache = /* @__PURE__ */ new Map();
async function disassemble(binaryPath, tool, sections, extraArgs) {
  const stat = fs2.statSync(binaryPath);
  const mtime = stat.mtimeMs;
  const cached = cache.get(binaryPath);
  if (cached && cached.mtime === mtime) {
    return cached.output;
  }
  const args = buildArgs(tool, binaryPath, sections, extraArgs);
  const { stdout } = await execFileAsync2(tool.path, args, {
    maxBuffer: 256 * 1024 * 1024,
    timeout: 12e4
  });
  cache.set(binaryPath, { mtime, output: stdout });
  return stdout;
}
function invalidateCache(binaryPath) {
  if (binaryPath) {
    cache.delete(binaryPath);
  } else {
    cache.clear();
  }
}
function buildArgs(tool, binaryPath, sections, extraArgs) {
  const args = [];
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

// src/objdumpParser.ts
var RE_FUNC = /^([0-9a-f]+)\s+<(.+)>:\s*$/;
var RE_INSTR = /^\s*([0-9a-f]+):\s+(.+)$/;
var RE_SOURCE_GNU = /^(.+):(\d+)(?:\s+\(discriminator\s+\d+\))?\s*$/;
var RE_SOURCE_LLVM = /^;\s+(.+):(\d+)\s*$/;
function parseObjdumpOutput(raw, toolType) {
  const lines = raw.split(/\r?\n/);
  const reSource = toolType === "llvm" ? RE_SOURCE_LLVM : RE_SOURCE_GNU;
  const functions = [];
  let currentFunc = null;
  let currentFile;
  let currentLine;
  for (const line of lines) {
    const trimmed = line.trimEnd();
    const funcMatch = trimmed.match(RE_FUNC);
    if (funcMatch) {
      currentFunc = {
        name: funcMatch[2],
        startAddress: funcMatch[1],
        lines: []
      };
      functions.push(currentFunc);
      currentFile = void 0;
      currentLine = void 0;
      continue;
    }
    const sourceMatch = trimmed.match(reSource);
    if (sourceMatch) {
      const filePart = sourceMatch[1];
      const linePart = parseInt(sourceMatch[2], 10);
      if (!isInstructionLine(trimmed) && looksLikeFilePath(filePart)) {
        currentFile = filePart;
        currentLine = linePart;
        continue;
      }
    }
    const instrMatch = trimmed.match(RE_INSTR);
    if (instrMatch && currentFunc) {
      currentFunc.lines.push({
        address: instrMatch[1],
        instruction: instrMatch[2].trimEnd(),
        sourceFile: currentFile,
        sourceLine: currentLine
      });
      continue;
    }
  }
  return functions;
}
function isInstructionLine(line) {
  return /^\s+[0-9a-f]+:\s/.test(line);
}
function looksLikeFilePath(s) {
  return /[/\\]/.test(s) || /^[a-zA-Z]:/.test(s);
}

// src/sourceAsmMapper.ts
var path2 = __toESM(require("path"));
function toUniform(p) {
  let s = p.replace(/\\/g, "/");
  if (/^[A-Z]:\//.test(s)) {
    s = s[0].toLowerCase() + s.slice(1);
  }
  return s;
}
var SourceAsmMapper = class {
  // source "normalizedPath:line" → asm document line numbers (0-based)
  sourceToAsm = /* @__PURE__ */ new Map();
  // asm document line number (0-based) → source location
  asmToSource = /* @__PURE__ */ new Map();
  // All unique normalized source keys for iteration
  allKeys = /* @__PURE__ */ new Set();
  sourceRoot;
  sourceRootUniform;
  constructor(sourceRoot) {
    this.sourceRoot = sourceRoot;
    this.sourceRootUniform = toUniform(sourceRoot);
  }
  build(functions) {
    this.sourceToAsm.clear();
    this.asmToSource.clear();
    this.allKeys.clear();
    const outputLines = [];
    let asmLineNum = 0;
    for (const func of functions) {
      outputLines.push(`<${func.name}>:`);
      asmLineNum++;
      for (const asmLine of func.lines) {
        const text = `  ${asmLine.address}:  ${asmLine.instruction}`;
        outputLines.push(text);
        if (asmLine.sourceFile && asmLine.sourceLine !== void 0) {
          const normFile = this.normalizePath(asmLine.sourceFile);
          const key = `${normFile}:${asmLine.sourceLine}`;
          let asmLines = this.sourceToAsm.get(key);
          if (!asmLines) {
            asmLines = [];
            this.sourceToAsm.set(key, asmLines);
          }
          asmLines.push(asmLineNum);
          this.allKeys.add(key);
          this.asmToSource.set(asmLineNum, {
            file: normFile,
            line: asmLine.sourceLine
          });
        }
        asmLineNum++;
      }
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
  getAsmLinesForSource(file, line) {
    const normFile = this.normalizePath(file);
    return this.sourceToAsm.get(`${normFile}:${line}`) || [];
  }
  getSourceForAsmLine(asmLine) {
    return this.asmToSource.get(asmLine);
  }
  /** Get all source keys that have asm mapping. */
  getAllSourceKeys() {
    return this.allKeys;
  }
  /** Get the raw sourceToAsm map for building color mapping. */
  getSourceToAsmMap() {
    return this.sourceToAsm;
  }
  resolveToWorkspace(normFile) {
    if (path2.isAbsolute(normFile)) {
      return normFile;
    }
    return path2.join(this.sourceRoot, normFile);
  }
  /**
   * Normalize a file path: make relative to sourceRoot if possible,
   * using uniform forward-slash comparison.
   */
  normalizePath(p) {
    const uni = toUniform(p);
    const root = this.sourceRootUniform.endsWith("/") ? this.sourceRootUniform : this.sourceRootUniform + "/";
    if (uni.startsWith(root)) {
      return uni.slice(root.length);
    }
    if (uni.startsWith(this.sourceRootUniform)) {
      return uni.slice(this.sourceRootUniform.length).replace(/^\//, "");
    }
    return uni;
  }
};

// src/decorationManager.ts
var vscode2 = __toESM(require("vscode"));
var PALETTE = [
  // красный
  {
    bg: "rgba(255, 120, 120, 0.18)",
    hover: "rgba(255, 100, 100, 0.42)",
    border: "#ff6666"
  },
  // синий
  {
    bg: "rgba(120, 180, 255, 0.18)",
    hover: "rgba(100, 160, 255, 0.42)",
    border: "#6699ff"
  },
  // зелёный
  {
    bg: "rgba(100, 220, 100, 0.18)",
    hover: "rgba(80, 200, 80, 0.42)",
    border: "#44cc44"
  },
  // жёлтый
  {
    bg: "rgba(255, 210, 80, 0.18)",
    hover: "rgba(255, 200, 50, 0.42)",
    border: "#ddaa00"
  },
  // фиолетовый
  {
    bg: "rgba(200, 130, 255, 0.18)",
    hover: "rgba(180, 100, 255, 0.42)",
    border: "#aa66ff"
  },
  // оранжевый
  {
    bg: "rgba(255, 170, 100, 0.18)",
    hover: "rgba(255, 150, 70, 0.42)",
    border: "#ee8833"
  },
  // бирюзовый
  {
    bg: "rgba(80, 220, 220, 0.18)",
    hover: "rgba(50, 200, 200, 0.42)",
    border: "#33bbbb"
  },
  // розовый
  {
    bg: "rgba(255, 130, 190, 0.18)",
    hover: "rgba(255, 100, 170, 0.42)",
    border: "#ee66aa"
  },
  // салатовый
  {
    bg: "rgba(170, 220, 100, 0.18)",
    hover: "rgba(150, 210, 70, 0.42)",
    border: "#88bb33"
  },
  // лавандовый
  {
    bg: "rgba(180, 180, 255, 0.18)",
    hover: "rgba(160, 160, 255, 0.42)",
    border: "#9999ff"
  },
  // коралловый
  {
    bg: "rgba(255, 160, 150, 0.18)",
    hover: "rgba(255, 130, 120, 0.42)",
    border: "#ee7766"
  },
  // мятный
  {
    bg: "rgba(120, 220, 190, 0.18)",
    hover: "rgba(90, 210, 170, 0.42)",
    border: "#55cc99"
  }
];
var DecorationManager = class {
  colorSlots = [];
  // sourceKey → palette index
  lineColorMap = /* @__PURE__ */ new Map();
  nextColorIndex = 0;
  // Saved mapping for access
  mappingEntries = [];
  constructor() {
    for (const color of PALETTE) {
      this.colorSlots.push({
        // Постоянный фон — цветная полоска, всегда видна
        normal: vscode2.window.createTextEditorDecorationType({
          backgroundColor: color.bg,
          isWholeLine: true,
          overviewRulerColor: color.border,
          overviewRulerLane: vscode2.OverviewRulerLane.Left
        }),
        // Hover — яркий фон + толстая цветная рамка слева
        hover: vscode2.window.createTextEditorDecorationType({
          backgroundColor: color.hover,
          isWholeLine: true,
          borderWidth: "0 0 0 4px",
          borderStyle: "solid",
          borderColor: color.border,
          overviewRulerColor: color.border,
          overviewRulerLane: vscode2.OverviewRulerLane.Full,
          fontWeight: "bold"
        })
      });
    }
  }
  /** Assign a palette color to a source key. Same key → same color. */
  getColorForKey(key) {
    let idx = this.lineColorMap.get(key);
    if (idx === void 0) {
      idx = this.nextColorIndex % PALETTE.length;
      this.nextColorIndex++;
      this.lineColorMap.set(key, idx);
    }
    return idx;
  }
  /**
   * Apply persistent color stripes to both editors.
   * Each source line ↔ asm block gets a distinct color from the palette.
   */
  applyColorMapping(sourceEditor, asmEditor2, mapping) {
    this.mappingEntries = mapping;
    this.lineColorMap.clear();
    this.nextColorIndex = 0;
    const sourceByColor = PALETTE.map(() => []);
    const asmByColor = PALETTE.map(() => []);
    for (const entry of mapping) {
      const ci = this.getColorForKey(entry.sourceKey);
      if (entry.sourceLine >= 0 && entry.sourceLine < sourceEditor.document.lineCount) {
        sourceByColor[ci].push(
          new vscode2.Range(entry.sourceLine, 0, entry.sourceLine, 0)
        );
      }
      for (const al of entry.asmLines) {
        if (al >= 0 && al < asmEditor2.document.lineCount) {
          asmByColor[ci].push(new vscode2.Range(al, 0, al, 0));
        }
      }
    }
    for (let i = 0; i < PALETTE.length; i++) {
      sourceEditor.setDecorations(this.colorSlots[i].normal, sourceByColor[i]);
      asmEditor2.setDecorations(this.colorSlots[i].normal, asmByColor[i]);
      sourceEditor.setDecorations(this.colorSlots[i].hover, []);
      asmEditor2.setDecorations(this.colorSlots[i].hover, []);
    }
  }
  /**
   * Highlight a matched pair brighter on cursor/click.
   * Uses the same color slot but with more opaque hover style.
   */
  highlightHover(sourceEditor, asmEditor2, sourceKey, sourceLine, asmLines) {
    this.clearHover(sourceEditor, asmEditor2);
    const ci = this.lineColorMap.get(sourceKey);
    if (ci === void 0)
      return;
    const slot = this.colorSlots[ci];
    if (sourceLine >= 0 && sourceLine < sourceEditor.document.lineCount) {
      sourceEditor.setDecorations(slot.hover, [
        new vscode2.Range(sourceLine, 0, sourceLine, 0)
      ]);
    }
    const asmRanges = asmLines.filter((n) => n >= 0 && n < asmEditor2.document.lineCount).map((n) => new vscode2.Range(n, 0, n, 0));
    asmEditor2.setDecorations(slot.hover, asmRanges);
  }
  /** Clear all hover highlights. Normal stripes remain. */
  clearHover(sourceEditor, asmEditor2) {
    for (const slot of this.colorSlots) {
      sourceEditor.setDecorations(slot.hover, []);
      asmEditor2.setDecorations(slot.hover, []);
    }
  }
  /** Clear everything (for reload). */
  clearAll(sourceEditor, asmEditor2) {
    for (const slot of this.colorSlots) {
      sourceEditor.setDecorations(slot.normal, []);
      sourceEditor.setDecorations(slot.hover, []);
      asmEditor2.setDecorations(slot.normal, []);
      asmEditor2.setDecorations(slot.hover, []);
    }
    this.lineColorMap.clear();
    this.nextColorIndex = 0;
    this.mappingEntries = [];
  }
  getMapping() {
    return this.mappingEntries;
  }
  scrollTo(editor, line) {
    if (line >= 0 && line < editor.document.lineCount) {
      editor.revealRange(
        new vscode2.Range(line, 0, line, 0),
        vscode2.TextEditorRevealType.InCenterIfOutsideViewport
      );
    }
  }
  dispose() {
    for (const slot of this.colorSlots) {
      slot.normal.dispose();
      slot.hover.dispose();
    }
  }
};

// src/liveCompiler.ts
var import_child_process3 = require("child_process");
var import_util3 = require("util");
var path3 = __toESM(require("path"));
var os = __toESM(require("os"));
var fs3 = __toESM(require("fs"));
var crypto = __toESM(require("crypto"));
var execFileAsync3 = (0, import_util3.promisify)(import_child_process3.execFile);
async function compileToObject(sourceFile, compileCommand, signal) {
  const hash = crypto.createHash("md5").update(sourceFile).digest("hex").slice(0, 12);
  const baseName = path3.basename(sourceFile, path3.extname(sourceFile));
  const outputPath = path3.join(os.tmpdir(), `yasm_${baseName}_${hash}.o`);
  const cmd = compileCommand.replace(/\{file\}/g, sourceFile).replace(/\{output\}/g, outputPath);
  const parts = parseCommand(cmd);
  if (parts.length === 0) {
    return { success: false, outputPath, stderr: "Empty compile command" };
  }
  const [program, ...args] = parts;
  try {
    const { stderr } = await execFileAsync3(program, args, {
      timeout: 3e4,
      maxBuffer: 10 * 1024 * 1024,
      signal
    });
    const exists = fs3.existsSync(outputPath);
    return {
      success: exists,
      outputPath,
      stderr: stderr || ""
    };
  } catch (err) {
    if (err.killed || err.code === "ABORT_ERR") {
      return { success: false, outputPath, stderr: "Compilation cancelled" };
    }
    return {
      success: false,
      outputPath,
      stderr: err.stderr || err.message || "Unknown compilation error"
    };
  }
}
function cleanupObjectFile(outputPath) {
  try {
    if (fs3.existsSync(outputPath)) {
      fs3.unlinkSync(outputPath);
    }
  } catch {
  }
}
function parseCommand(cmd) {
  const result = [];
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
    } else if (ch === " " || ch === "	") {
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

// src/extension.ts
var decorations;
var mapper;
var asmEditor;
var currentConfig;
var binaryWatcher;
var asmFilePath;
var statusBarItem;
var diffDecorations1;
var diffDecorations2;
var diffMapper1;
var diffMapper2;
var diffAsmEditor1;
var diffAsmEditor2;
var diffAsmPath1;
var diffAsmPath2;
var liveActive = false;
var liveConfig;
var liveTool;
var liveSourceFile;
var liveObjectPath;
var liveMapper;
var liveDecorations;
var liveAsmEditor;
var liveAsmPath;
var liveTimer;
var liveSaveDisposable;
var liveAbortController;
var liveRefreshing = false;
var liveOutputChannel;
var liveSections = [".text"];
var liveExtraArgs = [];
var liveSourceRoot = ".";
function activate(context) {
  decorations = new DecorationManager();
  context.subscriptions.push(decorations);
  statusBarItem = vscode3.window.createStatusBarItem(
    vscode3.StatusBarAlignment.Left,
    100
  );
  statusBarItem.command = "yasm.refresh";
  context.subscriptions.push(statusBarItem);
  context.subscriptions.push(
    vscode3.commands.registerCommand("yasm.showAssembly", cmdShowAssembly),
    vscode3.commands.registerCommand("yasm.refresh", cmdRefresh),
    vscode3.commands.registerCommand("yasm.initConfig", initConfig),
    vscode3.commands.registerCommand("yasm.diffAssembly", cmdDiffAssembly),
    vscode3.commands.registerCommand("yasm.liveMode", cmdLiveMode)
  );
  context.subscriptions.push(
    vscode3.window.onDidChangeTextEditorSelection(onSelectionChanged)
  );
  context.subscriptions.push(
    vscode3.window.onDidChangeVisibleTextEditors((editors) => {
      if (asmEditor && !editors.find((e) => e === asmEditor)) {
        asmEditor = void 0;
      }
      if (liveAsmEditor && !editors.find((e) => e === liveAsmEditor)) {
        stopLiveMode();
      }
    })
  );
}
function deactivate() {
  binaryWatcher?.dispose();
  statusBarItem?.hide();
  stopLiveMode();
}
function updateStatusBar(config, funcCount, toolType) {
  if (!statusBarItem)
    return;
  const binaryName = path4.basename(config.binary);
  statusBarItem.text = `$(file-binary) ${binaryName} | ${funcCount} funcs | ${toolType}`;
  statusBarItem.tooltip = `YASM: ${config.binary}
${funcCount} functions, ${toolType} objdump
Click to refresh`;
  statusBarItem.show();
}
async function cmdShowAssembly() {
  try {
    await loadAndShow();
  } catch (err) {
    vscode3.window.showErrorMessage(`YASM: ${err.message}`);
  }
}
async function cmdRefresh() {
  try {
    if (currentConfig) {
      invalidateCache(currentConfig.binary);
    }
    await loadAndShow();
  } catch (err) {
    vscode3.window.showErrorMessage(`YASM: ${err.message}`);
  }
}
async function cmdDiffAssembly() {
  try {
    const pick1 = await vscode3.window.showOpenDialog({
      canSelectFiles: true,
      canSelectFolders: false,
      canSelectMany: false,
      title: "Select first binary (e.g. compiled with -O1)"
    });
    if (!pick1 || pick1.length === 0)
      return;
    const pick2 = await vscode3.window.showOpenDialog({
      canSelectFiles: true,
      canSelectFolders: false,
      canSelectMany: false,
      title: "Select second binary (e.g. compiled with -O2)"
    });
    if (!pick2 || pick2.length === 0)
      return;
    const binary1 = pick1[0].fsPath;
    const binary2 = pick2[0].fsPath;
    let config;
    const configPath = getConfigPath();
    if (configPath && fs4.existsSync(configPath)) {
      try {
        config = await loadConfig();
      } catch {
      }
    }
    const tool = await detectObjdump(config?.objdump);
    const sections = config?.sections || [".text"];
    const extraArgs = config?.objdumpArgs || [];
    const statusMsg = vscode3.window.setStatusBarMessage("YASM: Diffing...");
    try {
      const [raw1, raw2] = await Promise.all([
        disassemble(binary1, tool, sections, extraArgs),
        disassemble(binary2, tool, sections, extraArgs)
      ]);
      const funcs1 = parseObjdumpOutput(raw1, tool.type);
      const funcs2 = parseObjdumpOutput(raw2, tool.type);
      const sourceRoot = config?.sourceRoot || vscode3.workspace.workspaceFolders?.[0]?.uri.fsPath || ".";
      diffMapper1 = new SourceAsmMapper(sourceRoot);
      diffMapper2 = new SourceAsmMapper(sourceRoot);
      const text1 = diffMapper1.build(funcs1);
      const text2 = diffMapper2.build(funcs2);
      const tmpDir = os2.tmpdir();
      const name1 = path4.basename(binary1);
      const name2 = path4.basename(binary2);
      diffAsmPath1 = path4.join(tmpDir, `${name1}_left.asm`);
      diffAsmPath2 = path4.join(tmpDir, `${name2}_right.asm`);
      fs4.writeFileSync(diffAsmPath1, text1, "utf-8");
      fs4.writeFileSync(diffAsmPath2, text2, "utf-8");
      diffDecorations1?.dispose();
      diffDecorations2?.dispose();
      diffDecorations1 = new DecorationManager();
      diffDecorations2 = new DecorationManager();
      const doc1 = await vscode3.workspace.openTextDocument(
        vscode3.Uri.file(diffAsmPath1)
      );
      diffAsmEditor1 = await vscode3.window.showTextDocument(doc1, {
        viewColumn: vscode3.ViewColumn.Two,
        preserveFocus: true,
        preview: false
      });
      const doc2 = await vscode3.workspace.openTextDocument(
        vscode3.Uri.file(diffAsmPath2)
      );
      diffAsmEditor2 = await vscode3.window.showTextDocument(doc2, {
        viewColumn: vscode3.ViewColumn.Three,
        preserveFocus: true,
        preview: false
      });
      applyDiffColors();
      vscode3.window.showInformationMessage(
        `YASM Diff: ${name1} (${funcs1.length} funcs) vs ${name2} (${funcs2.length} funcs)`
      );
    } finally {
      statusMsg.dispose();
    }
  } catch (err) {
    vscode3.window.showErrorMessage(`YASM Diff: ${err.message}`);
  }
}
function applyDiffColors() {
  const sourceEditor = findSourceEditor();
  if (!sourceEditor)
    return;
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
function buildMappingEntries(m, filePath) {
  const normFile = m.normalizePath(filePath);
  const sourceToAsm = m.getSourceToAsmMap();
  const entries = [];
  for (const [key, asmLines] of sourceToAsm) {
    const lastColon = key.lastIndexOf(":");
    if (lastColon === -1)
      continue;
    const keyFile = key.substring(0, lastColon);
    const keyLine = parseInt(key.substring(lastColon + 1), 10);
    if (keyFile !== normFile)
      continue;
    entries.push({
      sourceKey: key,
      sourceLine: keyLine - 1,
      asmLines
    });
  }
  return entries;
}
async function loadAndShow() {
  const config = await loadConfig();
  currentConfig = config;
  const tool = await detectObjdump(config.objdump);
  const statusMsg = vscode3.window.setStatusBarMessage("YASM: Disassembling...");
  let rawOutput;
  try {
    rawOutput = await disassemble(
      config.binary,
      tool,
      config.sections || [".text"],
      config.objdumpArgs || []
    );
  } finally {
    statusMsg.dispose();
  }
  if (!rawOutput.trim()) {
    throw new Error(
      "objdump produced empty output. Is the binary compiled with -g?"
    );
  }
  const functions = parseObjdumpOutput(rawOutput, tool.type);
  if (functions.length === 0) {
    throw new Error("No functions found in disassembly output.");
  }
  updateStatusBar(config, functions.length, tool.type);
  mapper = new SourceAsmMapper(config.sourceRoot);
  const asmText = mapper.build(functions);
  asmFilePath = config.binary.replace(/(\.[^.]+)?$/, ".asm");
  fs4.writeFileSync(asmFilePath, asmText, "utf-8");
  const asmUri = vscode3.Uri.file(asmFilePath);
  const doc = await vscode3.workspace.openTextDocument(asmUri);
  asmEditor = await vscode3.window.showTextDocument(doc, {
    viewColumn: vscode3.ViewColumn.Beside,
    preserveFocus: true,
    preview: false
  });
  applyColors();
  setupBinaryWatcher(config.binary);
  vscode3.window.showInformationMessage(
    `YASM: ${functions.length} functions \u2192 ${path4.basename(asmFilePath)}`
  );
}
function applyColors() {
  const sourceEditor = findSourceEditor();
  if (!sourceEditor || !asmEditor || !mapper)
    return;
  const entries = buildMappingEntries(mapper, sourceEditor.document.uri.fsPath);
  decorations.applyColorMapping(sourceEditor, asmEditor, entries);
}
function setupBinaryWatcher(binaryPath) {
  binaryWatcher?.dispose();
  const pattern = new vscode3.RelativePattern(
    path4.dirname(binaryPath),
    path4.basename(binaryPath)
  );
  binaryWatcher = vscode3.workspace.createFileSystemWatcher(pattern);
  binaryWatcher.onDidChange(() => {
    invalidateCache(binaryPath);
    loadAndShow().catch((err) => {
      vscode3.window.showErrorMessage(`YASM auto-refresh: ${err.message}`);
    });
  });
}
function onSelectionChanged(event) {
  const editor = event.textEditor;
  const line = event.selections[0].active.line;
  const editorPath = editor.document.uri.fsPath;
  if (mapper && asmEditor) {
    if (asmFilePath && editorPath === asmFilePath) {
      handleAsmClick(line);
      return;
    }
  }
  if (diffAsmPath1 && editorPath === diffAsmPath1 && diffMapper1) {
    handleDiffAsmClick(diffMapper1, diffDecorations1, diffAsmEditor1, line);
    return;
  }
  if (diffAsmPath2 && editorPath === diffAsmPath2 && diffMapper2) {
    handleDiffAsmClick(diffMapper2, diffDecorations2, diffAsmEditor2, line);
    return;
  }
  if (liveAsmPath && editorPath === liveAsmPath && liveMapper) {
    handleDiffAsmClick(liveMapper, liveDecorations, liveAsmEditor, line);
    return;
  }
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
        diffAsmEditor1
      );
    }
    if (diffMapper2 && diffAsmEditor2 && diffDecorations2) {
      handleDiffSourceClick(
        editor,
        line,
        diffMapper2,
        diffDecorations2,
        diffAsmEditor2
      );
    }
    if (liveMapper && liveAsmEditor && liveDecorations) {
      handleDiffSourceClick(
        editor,
        line,
        liveMapper,
        liveDecorations,
        liveAsmEditor
      );
    }
  }
}
function handleDiffSourceClick(sourceEditor, line, m, dec, asmEd) {
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
function handleDiffAsmClick(m, dec, asmEd, asmLine) {
  if (!dec || !asmEd)
    return;
  const source = m.getSourceForAsmLine(asmLine);
  const sourceEditor = findSourceEditor();
  if (!source || !sourceEditor) {
    if (sourceEditor)
      dec.clearHover(sourceEditor, asmEd);
    return;
  }
  const absPath = m.resolveToWorkspace(source.file);
  const editorLine = source.line - 1;
  const asmLines = m.getAsmLinesForSource(absPath, source.line);
  const sourceKey = `${source.file}:${source.line}`;
  dec.highlightHover(sourceEditor, asmEd, sourceKey, editorLine, asmLines);
  dec.scrollTo(sourceEditor, editorLine);
}
function handleSourceClick(sourceEditor, line) {
  if (!mapper || !asmEditor)
    return;
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
      asmLines
    );
    decorations.scrollTo(asmEditor, asmLines[0]);
  } else {
    decorations.clearHover(sourceEditor, asmEditor);
  }
}
function handleAsmClick(asmLine) {
  if (!mapper || !asmEditor)
    return;
  const source = mapper.getSourceForAsmLine(asmLine);
  if (!source) {
    const sourceEditor2 = findSourceEditor();
    if (sourceEditor2) {
      decorations.clearHover(sourceEditor2, asmEditor);
    }
    return;
  }
  const absPath = mapper.resolveToWorkspace(source.file);
  const sourceUri = vscode3.Uri.file(absPath);
  const sourceEditor = vscode3.window.visibleTextEditors.find(
    (e) => e.document.uri.fsPath === sourceUri.fsPath
  );
  if (sourceEditor) {
    const editorLine = source.line - 1;
    const asmLines = mapper.getAsmLinesForSource(absPath, source.line);
    const sourceKey = `${source.file}:${source.line}`;
    decorations.highlightHover(
      sourceEditor,
      asmEditor,
      sourceKey,
      editorLine,
      asmLines
    );
    decorations.scrollTo(sourceEditor, editorLine);
  }
}
async function cmdLiveMode() {
  try {
    if (liveActive) {
      stopLiveMode();
      statusBarItem?.hide();
      vscode3.window.showInformationMessage("YASM: Live mode stopped");
      return;
    }
    const sourceEditor = findSourceEditor();
    if (!sourceEditor) {
      vscode3.window.showErrorMessage("YASM: Open a C/C++ source file first");
      return;
    }
    const config = await loadConfig();
    if (!config.liveMode) {
      vscode3.window.showErrorMessage(
        'YASM: "liveMode" section not found in .yasm.json. Add compileCommand, trigger, etc.'
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
    if (!liveOutputChannel) {
      liveOutputChannel = vscode3.window.createOutputChannel("YASM Live");
    }
    liveOutputChannel.clear();
    liveDecorations?.dispose();
    liveDecorations = new DecorationManager();
    await liveRefresh();
    if (liveConfig.trigger === "live") {
      const interval = liveConfig.interval || 500;
      let lastContent = sourceEditor.document.getText();
      liveTimer = setInterval(() => {
        const editor = findSourceEditorByPath(liveSourceFile);
        if (!editor)
          return;
        const currentContent = editor.document.getText();
        if (currentContent !== lastContent) {
          lastContent = currentContent;
          editor.document.save().then(() => {
            liveRefresh().catch(() => {
            });
          });
        }
      }, interval);
    } else {
      liveSaveDisposable = vscode3.workspace.onDidSaveTextDocument((doc) => {
        if (liveSourceFile && doc.uri.fsPath === liveSourceFile) {
          liveRefresh().catch(() => {
          });
        }
      });
    }
    const triggerLabel = liveConfig.trigger === "live" ? `live (${liveConfig.interval || 500}ms)` : "on save";
    vscode3.window.showInformationMessage(
      `YASM: Live mode started [${triggerLabel}]`
    );
    updateLiveStatusBar(triggerLabel);
  } catch (err) {
    vscode3.window.showErrorMessage(`YASM Live: ${err.message}`);
  }
}
async function liveRefresh() {
  if (!liveActive || !liveConfig || !liveTool || !liveSourceFile)
    return;
  if (liveRefreshing)
    return;
  liveRefreshing = true;
  liveAbortController?.abort();
  liveAbortController = new AbortController();
  try {
    const result = await compileToObject(
      liveSourceFile,
      liveConfig.compileCommand,
      liveAbortController.signal
    );
    if (!result.success) {
      if (liveOutputChannel && result.stderr !== "Compilation cancelled") {
        liveOutputChannel.clear();
        liveOutputChannel.appendLine("\u2500\u2500 Compilation errors \u2500\u2500");
        liveOutputChannel.appendLine(result.stderr);
        liveOutputChannel.show(true);
      }
      statusBarItem.text = "$(error) YASM Live: compile error";
      return;
    }
    liveOutputChannel?.clear();
    if (liveObjectPath && liveObjectPath !== result.outputPath) {
      cleanupObjectFile(liveObjectPath);
    }
    liveObjectPath = result.outputPath;
    invalidateCache(result.outputPath);
    const rawOutput = await disassemble(
      result.outputPath,
      liveTool,
      liveSections,
      liveExtraArgs
    );
    if (!rawOutput.trim())
      return;
    const functions = parseObjdumpOutput(rawOutput, liveTool.type);
    if (functions.length === 0)
      return;
    liveMapper = new SourceAsmMapper(liveSourceRoot);
    const asmText = liveMapper.build(functions);
    const baseName = path4.basename(
      liveSourceFile,
      path4.extname(liveSourceFile)
    );
    const tmpAsmPath = path4.join(os2.tmpdir(), `yasm_live_${baseName}.asm`);
    fs4.writeFileSync(tmpAsmPath, asmText, "utf-8");
    liveAsmPath = tmpAsmPath;
    if (liveAsmEditor) {
      const doc = liveAsmEditor.document;
      if (doc.uri.fsPath === tmpAsmPath) {
        await vscode3.commands.executeCommand(
          "workbench.action.files.revert",
          doc.uri
        );
        liveAsmEditor = vscode3.window.visibleTextEditors.find(
          (e) => e.document.uri.fsPath === tmpAsmPath
        );
      }
    }
    if (!liveAsmEditor) {
      const doc = await vscode3.workspace.openTextDocument(
        vscode3.Uri.file(tmpAsmPath)
      );
      liveAsmEditor = await vscode3.window.showTextDocument(doc, {
        viewColumn: vscode3.ViewColumn.Beside,
        preserveFocus: true,
        preview: false
      });
    }
    const sourceEditor = findSourceEditorByPath(liveSourceFile);
    if (sourceEditor && liveAsmEditor && liveDecorations && liveMapper) {
      const entries = buildMappingEntries(liveMapper, liveSourceFile);
      liveDecorations.applyColorMapping(sourceEditor, liveAsmEditor, entries);
    }
    const triggerLabel = liveConfig.trigger === "live" ? `live (${liveConfig.interval || 500}ms)` : "on save";
    updateLiveStatusBar(triggerLabel, functions.length);
  } finally {
    liveRefreshing = false;
  }
}
function updateLiveStatusBar(triggerLabel, funcCount) {
  if (!statusBarItem)
    return;
  const funcs = funcCount !== void 0 ? ` | ${funcCount} funcs` : "";
  statusBarItem.text = `$(zap) YASM Live [${triggerLabel}]${funcs}`;
  statusBarItem.tooltip = `YASM Live Mode
Source: ${liveSourceFile}
Trigger: ${triggerLabel}
Click to refresh`;
  statusBarItem.show();
}
function stopLiveMode() {
  if (!liveActive)
    return;
  liveActive = false;
  if (liveTimer) {
    clearInterval(liveTimer);
    liveTimer = void 0;
  }
  liveSaveDisposable?.dispose();
  liveSaveDisposable = void 0;
  liveAbortController?.abort();
  liveAbortController = void 0;
  liveDecorations?.dispose();
  liveDecorations = void 0;
  liveMapper = void 0;
  liveAsmEditor = void 0;
  liveConfig = void 0;
  liveTool = void 0;
  liveSourceFile = void 0;
  liveAsmPath = void 0;
  liveRefreshing = false;
  if (liveObjectPath) {
    cleanupObjectFile(liveObjectPath);
    liveObjectPath = void 0;
  }
}
function findSourceEditorByPath(filePath) {
  return vscode3.window.visibleTextEditors.find(
    (e) => e.document.uri.fsPath === filePath
  );
}
function findSourceEditor() {
  return vscode3.window.visibleTextEditors.find((e) => isSourceEditor(e));
}
function isSourceEditor(editor) {
  const langId = editor.document.languageId;
  return editor.document.uri.scheme === "file" && (langId === "c" || langId === "cpp" || langId === "objective-c" || langId === "objective-cpp");
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  activate,
  deactivate
});
