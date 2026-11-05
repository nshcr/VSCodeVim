import * as assert from 'assert';
import * as vscode from 'vscode';

import { getAndUpdateModeHandler } from '../../extension';
import { Mode } from '../../src/mode/mode';
import { ModeHandler } from '../../src/mode/modeHandler';
import { taskQueue } from '../../src/taskQueue';
import { assertEqualLines, setupWorkspace } from '../testUtils';

suite('Digraph configuration overrides', () => {
  let modeHandler: ModeHandler;

  const command = async (name: string, args?: unknown): Promise<void> => {
    await vscode.commands.executeCommand(name, args);
    await new Promise<void>((resolve) => taskQueue.enqueueTask(async () => resolve()));
  };

  const insertDigraph = async (keys: string): Promise<void> => {
    await command('extension.vim_ctrl+k');
    for (const text of keys) {
      await command('type', { text });
    }
  };

  setup(async () => {
    await setupWorkspace({
      fileContent: [''],
      forceNewFile: true,
      config: { digraphs: { 'a*': ['a', 97], '*b': ['B', 66], 'R!': ['🚀', [55357, 56960]] } },
    });
    vscode.window.activeTextEditor!.selections = [new vscode.Selection(0, 0, 0, 0)];
    modeHandler = (await getAndUpdateModeHandler())!;
    modeHandler.syncCursors();
    await command('type', { text: 'i' });
  });

  test('a configured digraph overrides the same built-in shorthand', async () => {
    await insertDigraph('a*');
    assertEqualLines(['a']);
    assert.strictEqual(modeHandler.vimState.currentMode, Mode.Insert);
    assert.strictEqual(modeHandler.vimState.editor.selection.active.character, 1);
  });

  test('reverse fallback uses the configured override of a built-in shorthand', async () => {
    await insertDigraph('*a');
    assertEqualLines(['a']);
  });

  test('a direct built-in shorthand takes priority over a reversed custom shorthand', async () => {
    await insertDigraph('b*');
    assertEqualLines(['β']);
  });

  test('a direct custom shorthand takes priority over a reversed built-in shorthand', async () => {
    await insertDigraph('*b');
    assertEqualLines(['B']);
  });

  test('custom digraphs still accept UTF-16 arrays and reverse fallback', async () => {
    await insertDigraph('R!');
    await insertDigraph('!R');
    assertEqualLines(['🚀🚀']);
    assert.strictEqual(modeHandler.vimState.editor.selection.active.character, 4);
  });
});
