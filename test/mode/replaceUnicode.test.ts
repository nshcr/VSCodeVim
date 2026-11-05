import * as assert from 'assert';
import * as vscode from 'vscode';

import { getAndUpdateModeHandler } from '../../extension';
import { Mode } from '../../src/mode/mode';
import { ModeHandler } from '../../src/mode/modeHandler';
import { taskQueue } from '../../src/taskQueue';
import { assertEqualLines, setupWorkspace } from '../testUtils';

suite('Unicode Replace input', () => {
  let modeHandler: ModeHandler;

  const command = async (name: string, args?: unknown): Promise<void> => {
    await vscode.commands.executeCommand(name, args);
    await new Promise<void>((resolve) => taskQueue.enqueueTask(async () => resolve()));
  };

  const type = async (text: string): Promise<void> => command('type', { text });

  const reset = async (fileContent: string[]): Promise<void> => {
    await setupWorkspace({ fileContent });
    vscode.window.activeTextEditor!.selections = [new vscode.Selection(0, 0, 0, 0)];
    modeHandler = (await getAndUpdateModeHandler())!;
    modeHandler.syncCursors();
  };

  const assertCursor = (character: number): void => {
    assert.strictEqual(modeHandler.vimState.currentMode, Mode.Normal);
    assert.strictEqual(modeHandler.vimState.cursorStopPosition.character, character, 'Vim cursor');
    assert.strictEqual(
      modeHandler.vimState.editor.selection.active.character,
      character,
      'Editor cursor',
    );
  };

  setup(async () => {
    await reset(['abcdef']);
  });

  test('replaces a complete existing emoji with an ASCII character', async () => {
    await reset(['😀abc']);
    await type('R');
    await type('X');
    await command('extension.vim_escape');
    assertEqualLines(['Xabc']);
    assertCursor(0);
  });

  test('replaces successive characters with an emoji then ASCII', async () => {
    await type('R');
    await type('😀');
    await type('X');
    await command('extension.vim_escape');
    assertEqualLines(['😀Xcdef']);
    assertCursor(2);
  });

  test('backs out a complete replacement emoji', async () => {
    await type('R');
    await type('😀');
    await modeHandler.handleKeyEvent('<BS>');
    await command('extension.vim_escape');
    assertEqualLines(['abcdef']);
    assertCursor(0);
  });

  test('restores an original emoji when backing out an ASCII replacement', async () => {
    await reset(['😀abc']);
    await type('R');
    await type('X');
    await modeHandler.handleKeyEvent('<BS>');
    assertEqualLines(['😀abc']);
    assert.strictEqual(modeHandler.vimState.cursorStopPosition.character, 0);
  });

  test('moves back over a complete emoji before making any replacements', async () => {
    await reset(['😀abc']);
    modeHandler.vimState.editor.selection = new vscode.Selection(0, 2, 0, 2);
    modeHandler.syncCursors();
    await type('R');
    await modeHandler.handleKeyEvent('<BS>');
    assertEqualLines(['😀abc']);
    assert.strictEqual(modeHandler.vimState.cursorStopPosition.character, 0);
  });

  test('backs out an emoji appended beyond the original line', async () => {
    await reset(['']);
    await type('R');
    await type('😀');
    await modeHandler.handleKeyEvent('<BS>');
    await command('extension.vim_escape');
    assertEqualLines(['']);
    assertCursor(0);
  });

  test('processes a multi-character Chinese type payload as successive replacements', async () => {
    await type('R');
    await type('中文');
    await command('extension.vim_escape');
    assertEqualLines(['中文cdef']);
    assertCursor(1);
  });

  test('normal-mode counted replacement leaves the cursor at the last complete emoji', async () => {
    await type('2');
    await type('r');
    await type('😀');
    assertEqualLines(['😀😀cdef']);
    assertCursor(2);
  });

  test('counted Replace mode repeats Unicode characters rather than UTF-16 units', async () => {
    await type('2');
    await type('R');
    await type('😀');
    await command('extension.vim_escape');
    assertEqualLines(['😀😀cdef']);
    assertCursor(2);
  });

  test('counted Replace mode replaces a complete following emoji', async () => {
    await reset(['a😀cdef']);
    await type('2');
    await type('R');
    await type('X');
    await command('extension.vim_escape');
    assertEqualLines(['XXcdef']);
    assertCursor(1);
  });

  test('undoes and redoes Unicode replacement without splitting characters', async () => {
    await type('R');
    await type('😀');
    await type('X');
    await command('extension.vim_escape');
    await type('u');
    assertEqualLines(['abcdef']);
    await modeHandler.handleKeyEvent('<C-r>');
    assertEqualLines(['😀Xcdef']);
  });

  test('replaces complete Unicode characters at each cursor', async () => {
    await reset(['😀abc', '😀def']);
    modeHandler.vimState.editor.selections = [
      new vscode.Selection(0, 0, 0, 0),
      new vscode.Selection(1, 0, 1, 0),
    ];
    modeHandler.syncCursors();
    await type('R');
    await type('X');
    await command('extension.vim_escape');
    assertEqualLines(['Xabc', 'Xdef']);
    assert.deepStrictEqual(
      modeHandler.vimState.editor.selections.map(({ active }) => [active.line, active.character]),
      [
        [0, 0],
        [1, 0],
      ],
    );
  });
});
