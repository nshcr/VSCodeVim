import * as assert from 'assert';
import * as vscode from 'vscode';

import { getAndUpdateModeHandler } from '../extension';
import { Mode } from '../src/mode/mode';
import { taskQueue } from '../src/taskQueue';
import { assertEqualLines, setupWorkspace } from './testUtils';

suite('Current word searches with literal punctuation', () => {
  // VSCodeVim's iskeyword setting is the list of word separators, unlike Vim's
  // option. Excluding . and $ corresponds to adding them to Vim's iskeyword.
  const separators = '/\\()"\':,.;<>~!@#$%^&*|+=[]{}`?-'.replace(/[.$]/g, '');

  for (const word of ['foo.bar', 'foo$bar']) {
    const line = `${word} fooXbar ${word} ${word}`;
    const occurrences = [0, word.length + 9, 2 * word.length + 10];
    // Cursor positions verified with macOS Vim 9.1 and Homebrew Vim 9.2.
    for (const [keys, start, end] of [
      ['*', 0, 1],
      ['#', 2, 1],
      ['*n', 0, 2],
      ['*nN', 0, 1],
      ['#n', 2, 0],
      ['#nN', 2, 1],
      ['g*', 0, 1],
      ['g#', 2, 1],
    ] as const) {
      test(`${keys} searches ${word} literally and preserves repeat direction`, async () => {
        await setupWorkspace({
          fileContent: [line],
          forceNewFile: true,
          config: { iskeyword: separators },
        });
        const editor = vscode.window.activeTextEditor!;
        editor.selections = [new vscode.Selection(0, occurrences[start], 0, occurrences[start])];
        const modeHandler = (await getAndUpdateModeHandler())!;
        modeHandler.syncCursors();

        for (const text of keys) {
          await vscode.commands.executeCommand('type', { text });
          await new Promise<void>((resolve) => taskQueue.enqueueTask(async () => resolve()));
        }

        assertEqualLines([line]);
        assert.strictEqual(modeHandler.vimState.currentMode, Mode.Normal);
        assert.strictEqual(modeHandler.vimState.cursorStopPosition.character, occurrences[end]);
        assert.strictEqual(editor.selection.active.character, occurrences[end]);
      });
    }
  }
});
