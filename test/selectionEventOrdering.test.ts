import * as assert from 'assert';
import * as vscode from 'vscode';

import { getAndUpdateModeHandler } from '../extension';
import { Mode } from '../src/mode/mode';
import { ModeHandler } from '../src/mode/modeHandler';
import { taskQueue } from '../src/taskQueue';
import { setupWorkspace } from './testUtils';

// These are event-boundary tests: the supplied event is deliberately older
// than the editor's real selection. They do not simulate a physical mouse.
suite('Selection event ordering', () => {
  let editor: vscode.TextEditor;
  let handler: ModeHandler;
  const drain = async () => {
    await new Promise<void>((resolve) => taskQueue.enqueueTask(async () => resolve()));
  };

  setup(async () => {
    await setupWorkspace({ fileContent: ['0123456789'], forceNewFile: true });
    editor = vscode.window.activeTextEditor!;
    editor.selection = new vscode.Selection(0, 0, 0, 0);
    handler = (await getAndUpdateModeHandler())!;
    handler.syncCursors();
    await vscode.commands.executeCommand('type', { text: 'i' });
    await drain();
  });

  test('a delayed input caret cannot rewind the Normal cursor after Escape', async () => {
    editor.selection = new vscode.Selection(0, 4, 0, 4);
    await drain();
    handler.syncCursors();
    await vscode.commands.executeCommand('extension.vim_escape');
    await drain();
    assert.strictEqual(handler.vimState.currentMode, Mode.Normal);
    assert.strictEqual(editor.selection.active.character, 3);
    await handler.handleSelectionChange({
      textEditor: editor,
      selections: [new vscode.Selection(0, 4, 0, 4)],
      kind: vscode.TextEditorSelectionChangeKind.Command,
    });
    assert.strictEqual(handler.vimState.cursorStopPosition.character, 3);
    assert.strictEqual(editor.selection.active.character, 3);
  });

  test('an older selection with the opposite direction cannot overwrite the live typing range', async () => {
    editor.selection = new vscode.Selection(0, 5, 0, 2);
    await drain();
    await handler.handleSelectionChange({
      textEditor: editor,
      selections: editor.selections,
      kind: vscode.TextEditorSelectionChangeKind.Command,
    });
    await handler.handleSelectionChange({
      textEditor: editor,
      selections: [new vscode.Selection(0, 2, 0, 5)],
      kind: vscode.TextEditorSelectionChangeKind.Command,
    });
    assert.strictEqual(handler.vimState.currentMode, Mode.Insert);
    assert.strictEqual(handler.vimState.cursorStartPosition.character, 5);
    assert.strictEqual(handler.vimState.cursorStopPosition.character, 2);
    assert.ok(editor.selection.isReversed);
  });
});
