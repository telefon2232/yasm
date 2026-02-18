import * as vscode from "vscode";

export const ASM_SCHEME = "yasm";

/** Провайдер виртуальных документов — контент в памяти, без записи на диск */
export class AsmDocumentProvider
  implements vscode.TextDocumentContentProvider
{
  private content = new Map<string, string>();
  private _onDidChange = new vscode.EventEmitter<vscode.Uri>();
  readonly onDidChange = this._onDidChange.event;

  /** Обновить (или создать) контент для URI */
  update(uri: vscode.Uri, text: string): void {
    this.content.set(uri.toString(), text);
    this._onDidChange.fire(uri);
  }

  provideTextDocumentContent(uri: vscode.Uri): string {
    return this.content.get(uri.toString()) ?? "";
  }

  dispose(): void {
    this._onDidChange.dispose();
  }
}

/** Сгенерировать URI для виртуального asm-документа */
export function buildAsmUri(name: string): vscode.Uri {
  return vscode.Uri.parse(`${ASM_SCHEME}:///${encodeURIComponent(name)}`);
}
