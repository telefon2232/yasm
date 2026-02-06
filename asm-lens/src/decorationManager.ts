import * as vscode from "vscode";

// Godbolt-style color palette — яркие, хорошо различимые цвета.
// bg: постоянный фон (видимый, но не кричащий)
// hover: яркий фон при наведении/клике
// border: цвет левой рамки при hover
const PALETTE = [
  // красный
  {
    bg: "rgba(255, 120, 120, 0.18)",
    hover: "rgba(255, 100, 100, 0.42)",
    border: "#ff6666",
  },
  // синий
  {
    bg: "rgba(120, 180, 255, 0.18)",
    hover: "rgba(100, 160, 255, 0.42)",
    border: "#6699ff",
  },
  // зелёный
  {
    bg: "rgba(100, 220, 100, 0.18)",
    hover: "rgba(80, 200, 80, 0.42)",
    border: "#44cc44",
  },
  // жёлтый
  {
    bg: "rgba(255, 210, 80, 0.18)",
    hover: "rgba(255, 200, 50, 0.42)",
    border: "#ddaa00",
  },
  // фиолетовый
  {
    bg: "rgba(200, 130, 255, 0.18)",
    hover: "rgba(180, 100, 255, 0.42)",
    border: "#aa66ff",
  },
  // оранжевый
  {
    bg: "rgba(255, 170, 100, 0.18)",
    hover: "rgba(255, 150, 70, 0.42)",
    border: "#ee8833",
  },
  // бирюзовый
  {
    bg: "rgba(80, 220, 220, 0.18)",
    hover: "rgba(50, 200, 200, 0.42)",
    border: "#33bbbb",
  },
  // розовый
  {
    bg: "rgba(255, 130, 190, 0.18)",
    hover: "rgba(255, 100, 170, 0.42)",
    border: "#ee66aa",
  },
  // салатовый
  {
    bg: "rgba(170, 220, 100, 0.18)",
    hover: "rgba(150, 210, 70, 0.42)",
    border: "#88bb33",
  },
  // лавандовый
  {
    bg: "rgba(180, 180, 255, 0.18)",
    hover: "rgba(160, 160, 255, 0.42)",
    border: "#9999ff",
  },
  // коралловый
  {
    bg: "rgba(255, 160, 150, 0.18)",
    hover: "rgba(255, 130, 120, 0.42)",
    border: "#ee7766",
  },
  // мятный
  {
    bg: "rgba(120, 220, 190, 0.18)",
    hover: "rgba(90, 210, 170, 0.42)",
    border: "#55cc99",
  },
];

interface ColorSlot {
  normal: vscode.TextEditorDecorationType;
  hover: vscode.TextEditorDecorationType;
}

export interface MappingEntry {
  sourceKey: string; // "normalizedPath:line"
  sourceLine: number; // 0-based editor line
  asmLines: number[]; // 0-based asm editor lines
}

export class DecorationManager {
  private colorSlots: ColorSlot[] = [];

  // sourceKey → palette index
  private lineColorMap = new Map<string, number>();
  private nextColorIndex = 0;

  // Saved mapping for access
  private mappingEntries: MappingEntry[] = [];

  constructor() {
    for (const color of PALETTE) {
      this.colorSlots.push({
        // Постоянный фон — цветная полоска, всегда видна
        normal: vscode.window.createTextEditorDecorationType({
          backgroundColor: color.bg,
          isWholeLine: true,
          overviewRulerColor: color.border,
          overviewRulerLane: vscode.OverviewRulerLane.Left,
        }),
        // Hover — яркий фон + толстая цветная рамка слева
        hover: vscode.window.createTextEditorDecorationType({
          backgroundColor: color.hover,
          isWholeLine: true,
          borderWidth: "0 0 0 4px",
          borderStyle: "solid",
          borderColor: color.border,
          overviewRulerColor: color.border,
          overviewRulerLane: vscode.OverviewRulerLane.Full,
          fontWeight: "bold",
        }),
      });
    }
  }

  /** Assign a palette color to a source key. Same key → same color. */
  private getColorForKey(key: string): number {
    let idx = this.lineColorMap.get(key);
    if (idx === undefined) {
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
  applyColorMapping(
    sourceEditor: vscode.TextEditor,
    asmEditor: vscode.TextEditor,
    mapping: MappingEntry[],
  ): void {
    this.mappingEntries = mapping;

    // Reset color assignments for fresh mapping
    this.lineColorMap.clear();
    this.nextColorIndex = 0;

    const sourceByColor: vscode.Range[][] = PALETTE.map(() => []);
    const asmByColor: vscode.Range[][] = PALETTE.map(() => []);

    for (const entry of mapping) {
      const ci = this.getColorForKey(entry.sourceKey);

      if (
        entry.sourceLine >= 0 &&
        entry.sourceLine < sourceEditor.document.lineCount
      ) {
        sourceByColor[ci].push(
          new vscode.Range(entry.sourceLine, 0, entry.sourceLine, 0),
        );
      }

      for (const al of entry.asmLines) {
        if (al >= 0 && al < asmEditor.document.lineCount) {
          asmByColor[ci].push(new vscode.Range(al, 0, al, 0));
        }
      }
    }

    for (let i = 0; i < PALETTE.length; i++) {
      sourceEditor.setDecorations(this.colorSlots[i].normal, sourceByColor[i]);
      asmEditor.setDecorations(this.colorSlots[i].normal, asmByColor[i]);
      // Clear hover layer
      sourceEditor.setDecorations(this.colorSlots[i].hover, []);
      asmEditor.setDecorations(this.colorSlots[i].hover, []);
    }
  }

  /**
   * Highlight a matched pair brighter on cursor/click.
   * Uses the same color slot but with more opaque hover style.
   */
  highlightHover(
    sourceEditor: vscode.TextEditor,
    asmEditor: vscode.TextEditor,
    sourceKey: string,
    sourceLine: number,
    asmLines: number[],
  ): void {
    this.clearHover(sourceEditor, asmEditor);

    const ci = this.lineColorMap.get(sourceKey);
    if (ci === undefined) return;

    const slot = this.colorSlots[ci];

    if (sourceLine >= 0 && sourceLine < sourceEditor.document.lineCount) {
      sourceEditor.setDecorations(slot.hover, [
        new vscode.Range(sourceLine, 0, sourceLine, 0),
      ]);
    }

    const asmRanges = asmLines
      .filter((n) => n >= 0 && n < asmEditor.document.lineCount)
      .map((n) => new vscode.Range(n, 0, n, 0));
    asmEditor.setDecorations(slot.hover, asmRanges);
  }

  /** Clear all hover highlights. Normal stripes remain. */
  clearHover(
    sourceEditor: vscode.TextEditor,
    asmEditor: vscode.TextEditor,
  ): void {
    for (const slot of this.colorSlots) {
      sourceEditor.setDecorations(slot.hover, []);
      asmEditor.setDecorations(slot.hover, []);
    }
  }

  /** Clear everything (for reload). */
  clearAll(
    sourceEditor: vscode.TextEditor,
    asmEditor: vscode.TextEditor,
  ): void {
    for (const slot of this.colorSlots) {
      sourceEditor.setDecorations(slot.normal, []);
      sourceEditor.setDecorations(slot.hover, []);
      asmEditor.setDecorations(slot.normal, []);
      asmEditor.setDecorations(slot.hover, []);
    }
    this.lineColorMap.clear();
    this.nextColorIndex = 0;
    this.mappingEntries = [];
  }

  getMapping(): MappingEntry[] {
    return this.mappingEntries;
  }

  scrollTo(editor: vscode.TextEditor, line: number): void {
    if (line >= 0 && line < editor.document.lineCount) {
      editor.revealRange(
        new vscode.Range(line, 0, line, 0),
        vscode.TextEditorRevealType.InCenterIfOutsideViewport,
      );
    }
  }

  dispose(): void {
    for (const slot of this.colorSlots) {
      slot.normal.dispose();
      slot.hover.dispose();
    }
  }
}
