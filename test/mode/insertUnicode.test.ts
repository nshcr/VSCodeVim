import * as assert from 'assert';
import * as vscode from 'vscode';

import { getAndUpdateModeHandler } from '../../extension';
import { Mode } from '../../src/mode/mode';
import { ModeHandler } from '../../src/mode/modeHandler';
import { taskQueue } from '../../src/taskQueue';
import { assertEqualLines, setupWorkspace } from '../testUtils';

suite('Unicode Insert input', () => {
  let mh: ModeHandler;

  const command = async (name: string, args?: unknown): Promise<void> => {
    await vscode.commands.executeCommand(name, args);
    await new Promise<void>((resolve) => taskQueue.enqueueTask(async () => resolve()));
  };

  setup(async () => {
    await setupWorkspace({ fileContent: ['abc', 'def'] });
    vscode.window.activeTextEditor!.selections = [new vscode.Selection(0, 0, 0, 0)];
    mh = (await getAndUpdateModeHandler())!;
    mh.syncCursors();
  });

  for (const exit of ['<Esc>', '<C-c>', '<C-[>']) {
    test(`${exit} leaves the cursor at the start of the inserted emoji`, async () => {
      await mh.handleKeyEvent('i');
      await command('type', { text: '😀' });
      await mh.handleKeyEvent(exit);
      assertEqualLines(['😀abc', 'def']);
      assert.strictEqual(mh.vimState.currentMode, Mode.Normal);
      assert.strictEqual(mh.vimState.cursorStopPosition.character, 0);
      assert.strictEqual(mh.vimState.editor.selection.active.character, 0);
      await mh.handleKeyEvent('x');
      assertEqualLines(['abc', 'def']);
    });
  }

  test('exits emoji composition at a complete character on every cursor', async () => {
    await mh.handleKeyEvent('i');
    mh.vimState.editor.selections = [
      new vscode.Selection(0, 0, 0, 0),
      new vscode.Selection(1, 0, 1, 0),
    ];
    mh.syncCursors();
    await command('compositionStart');
    await command('type', { text: '😀' });
    await command('compositionEnd');
    await mh.handleKeyEvent('<Esc>');
    assert.deepStrictEqual(
      mh.vimState.cursors.map(({ stop }) => [stop.line, stop.character]),
      [
        [0, 0],
        [1, 0],
      ],
    );
    await mh.handleKeyEvent('x');
    assertEqualLines(['abc', 'def']);
  });

  test('repeats and undoes inserted emoji without splitting the character', async () => {
    await mh.handleKeyEvent('i');
    await command('type', { text: '😀' });
    await mh.handleMultipleKeyEvents(['<Esc>', 'j', '.']);
    assertEqualLines(['😀abc', '😀def']);
    assert.strictEqual(mh.vimState.cursorStopPosition.character, 0);
    await mh.handleKeyEvent('u');
    assertEqualLines(['😀abc', 'def']);
  });

  test('counted insertion leaves the cursor at the final complete emoji', async () => {
    await mh.handleMultipleKeyEvents(['2', 'i']);
    await command('type', { text: '😀' });
    await mh.handleKeyEvent('<Esc>');
    assertEqualLines(['😀😀abc', 'def']);
    assert.strictEqual(mh.vimState.cursorStopPosition.character, 2);
    await mh.handleKeyEvent('x');
    assertEqualLines(['😀abc', 'def']);
  });

  test('temporary Normal mode preserves the insertion point after an emoji', async () => {
    await mh.handleKeyEvent('i');
    await command('type', { text: '😀' });
    await mh.handleMultipleKeyEvents(['<C-o>', 'h']);
    await command('type', { text: 'X' });
    assertEqualLines(['X😀abc', 'def']);
    assert.strictEqual(mh.vimState.currentMode, Mode.Insert);
  });
});
