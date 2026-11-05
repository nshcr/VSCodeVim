import * as assert from 'assert';
import * as vscode from 'vscode';

import { getAndUpdateModeHandler } from '../extension';
import { Mode } from '../src/mode/mode';
import { ModeHandler } from '../src/mode/modeHandler';
import { taskQueue } from '../src/taskQueue';
import { TextEditor } from '../src/textEditor';
import { assertEqualLines, setupWorkspace } from './testUtils';

suite('IME selection replacement', () => {
  let modeHandler: ModeHandler;
  let editor: vscode.TextEditor;

  const command = async (name: string, args?: unknown): Promise<void> => {
    await vscode.commands.executeCommand(name, args);
    await new Promise<void>((resolve) => {
      taskQueue.enqueueTask(async () => resolve());
    });
  };

  setup(async () => {
    await setupWorkspace({ fileContent: ['one two', 'three four', 'five six'] });
    modeHandler = (await getAndUpdateModeHandler())!;
    await modeHandler.handleKeyEvent('i');
    editor = modeHandler.vimState.editor;
  });

  for (const reversed of [false, true]) {
    test(`multi-character type replaces a ${reversed ? 'backward' : 'forward'} selection`, async () => {
      editor.selection = reversed
        ? new vscode.Selection(0, 3, 0, 0)
        : new vscode.Selection(0, 0, 0, 3);
      await command('type', { text: '你好' });
      assertEqualLines(['你好 two', 'three four', 'five six']);
      assert.ok(editor.selection.isEmpty);
      assert.ok(editor.selection.active.isEqual(new vscode.Position(0, 2)));
      assert.strictEqual(modeHandler.vimState.currentMode, Mode.Insert);
      await command('type', { text: '!' });
      assertEqualLines(['你好! two', 'three four', 'five six']);
    });
  }

  test('multi-character type replaces every selection and inserts at empty cursors', async () => {
    editor.selections = [
      new vscode.Selection(0, 0, 0, 3),
      new vscode.Selection(1, 5, 1, 0),
      new vscode.Selection(2, 4, 2, 4),
    ];
    modeHandler.syncCursors();
    await command('type', { text: '你好' });
    assertEqualLines(['你好 two', '你好 four', 'five你好 six']);
    assert.strictEqual(editor.selections.length, 3);
    assert.ok(editor.selections.every((selection) => selection.isEmpty));
    assert.strictEqual(modeHandler.vimState.currentMode, Mode.Insert);
    await command('type', { text: '!' });
    assertEqualLines(['你好! two', '你好! four', 'five你好! six']);
  });

  test('manual typing replaces selections on one line regardless of cursor order', async () => {
    editor.selections = [new vscode.Selection(0, 7, 0, 4), new vscode.Selection(0, 0, 0, 3)];
    await TextEditor.insert(editor, '中文');
    assertEqualLines(['中文 中文', 'three four', 'five six']);
    assert.ok(editor.selections.every((selection) => selection.isEmpty));
    assert.deepStrictEqual(
      editor.selections.map(({ active }) => [active.line, active.character]),
      [
        [0, 5],
        [0, 2],
      ],
    );
  });

  test('manual typing still inserts at every empty cursor', async () => {
    editor.selections = [new vscode.Selection(0, 3, 0, 3), new vscode.Selection(1, 5, 1, 5)];
    await TextEditor.insert(editor, '中文');
    assertEqualLines(['one中文 two', 'three中文 four', 'five six']);
  });

  test('explicit insertion positions leave the selected text intact', async () => {
    editor.selection = new vscode.Selection(0, 0, 0, 3);
    await TextEditor.insert(editor, '中文', new vscode.Position(1, 0), false);
    assertEqualLines(['one two', '中文three four', 'five six']);
    assert.ok(!editor.selection.isEmpty);
  });

  test('manual single-character typing also replaces its selection', async () => {
    editor.selection = new vscode.Selection(0, 0, 0, 3);
    await TextEditor.insert(editor, '你', undefined, false);
    assertEqualLines(['你 two', 'three four', 'five six']);
  });
});
