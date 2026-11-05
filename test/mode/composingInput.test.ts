import * as assert from 'assert';
import * as vscode from 'vscode';

import { getAndUpdateModeHandler } from '../../extension';
import { Mode } from '../../src/mode/mode';
import { taskQueue } from '../../src/taskQueue';
import nativeVim from '../fixtures/vimComposingInput';
import { assertEqualLines, setupWorkspace } from '../testUtils';

const command = async (name: string, args?: unknown): Promise<void> => {
  await vscode.commands.executeCommand(name, args);
  await new Promise<void>((resolve) => taskQueue.enqueueTask(async () => resolve()));
};

const keys = async (sequence: string[]): Promise<void> => {
  for (const key of sequence) {
    if (key.startsWith('<')) {
      await command('vim.remap', { after: [key] });
    } else {
      await command('type', { text: key });
    }
  }
};

suite('Native Vim composing input', () => {
  // Literal results captured from both macOS Vim versions, rather than inferred
  // from JS grapheme segmentation. In particular R consumes each input codepoint.
  const operations: Record<string, [string[], string[]]> = {
    insert_escape: [['i'], ['<Esc>']],
    insert_backspace: [['i'], ['<BS>', '<Esc>']],
    insert_two_backspaces: [['i'], ['<BS>', '<BS>', '<Esc>']],
    replace_escape: [['R'], ['<Esc>']],
    replace_backspace: [['R'], ['<BS>', '<Esc>']],
    replace_then_X: [['R'], ['X', '<Esc>']],
    r: [['r'], []],
    '2r': [['2', 'r'], []],
    '2i': [['2', 'i'], ['<Esc>']],
    '2R': [['2', 'R'], ['<Esc>']],
    insert_undo: [['i'], ['<Esc>', 'u']],
    replace_undo: [['R'], ['<Esc>', 'u']],
  };

  for (const expected of nativeVim.cases) {
    test(expected.name, async () => {
      await setupWorkspace({ fileContent: ['abcdef'], forceNewFile: true });
      const editor = vscode.window.activeTextEditor!;
      editor.selections = [new vscode.Selection(0, 0, 0, 0)];
      const mh = (await getAndUpdateModeHandler())!;
      mh.syncCursors();
      const [before, after] = operations[expected.operation];
      await keys(before);
      await command('type', { text: expected.text });
      await keys(after);
      assertEqualLines(expected.lines);
      assert.strictEqual(mh.vimState.currentMode, Mode.Normal);
      assert.deepStrictEqual(
        [editor.selection.active.line, editor.selection.active.character],
        expected.cursor,
        'Editor cursor matches native Vim',
      );
      assert.deepStrictEqual(
        [mh.vimState.cursorStopPosition.line, mh.vimState.cursorStopPosition.character],
        expected.cursor,
        'Vim cursor matches native Vim',
      );
    });
  }
});

suite('Composing input integration', () => {
  for (const composition of [false, true]) {
    test(`${composition ? 'composed' : 'direct'} text payload changes segmentation when entering Replace`, async () => {
      await setupWorkspace({ fileContent: ['abcdef'], forceNewFile: true });
      const mh = (await getAndUpdateModeHandler())!;
      if (composition) await command('compositionStart');
      await command('type', { text: 'Re\u0301' });
      if (composition) await command('compositionEnd');
      assertEqualLines(['e\u0301cdef']);
      assert.strictEqual(mh.vimState.currentMode, Mode.Replace);
      assert.strictEqual(mh.vimState.cursorStopPosition.character, 2);
      await keys(['<Esc>']);
      assert.strictEqual(mh.vimState.cursorStopPosition.character, 0);
    });
  }

  test('composition commits a decomposed accent and exits on its base', async () => {
    await setupWorkspace({ fileContent: ['abcdef'], forceNewFile: true });
    const mh = (await getAndUpdateModeHandler())!;
    await keys(['i']);
    await command('compositionStart');
    await command('type', { text: 'e' });
    await command('replacePreviousChar', { text: 'e\u0301', replaceCharCnt: 1 });
    await command('compositionEnd');
    assertEqualLines(['e\u0301abcdef']);
    assert.strictEqual(mh.vimState.cursorStopPosition.character, 2);
    await keys(['<Esc>', 'x']);
    assertEqualLines(['abcdef']);
  });

  test('Replace composition preserves native per-codepoint consumption and backspace', async () => {
    await setupWorkspace({ fileContent: ['abcdef'], forceNewFile: true });
    await keys(['R']);
    await command('compositionStart');
    await command('type', { text: 'e\u0301' });
    await command('compositionEnd');
    assertEqualLines(['e\u0301cdef']);
    await keys(['<BS>', '<Esc>']);
    assertEqualLines(['bcdef']);
  });

  test('r composition consumes the first Vim character from a ZWJ sequence', async () => {
    await setupWorkspace({ fileContent: ['abcdef'], forceNewFile: true });
    const mh = (await getAndUpdateModeHandler())!;
    await keys(['2', 'r']);
    await command('compositionStart');
    await command('type', { text: '🏳️\u200d🌈' });
    await command('compositionEnd');
    assertEqualLines(['🏳️🏳️cdef']);
    assert.strictEqual(mh.vimState.cursorStopPosition.character, 3);
  });

  test('backspace preserves deletion of a natively auto-closed ASCII pair', async () => {
    await setupWorkspace({ fileContent: [''], fileExtension: '.ts', forceNewFile: true });
    await keys(['i']);
    await command('type', { text: '(' });
    assertEqualLines(['()']);
    await keys(['<BS>']);
    assertEqualLines(['']);
  });

  test('mixed cursors backspace Unicode units and retain native ASCII deletion', async () => {
    await setupWorkspace({
      fileContent: ['e\u0301', '', '  ', '👩\u200d💻'],
      fileExtension: '.ts',
      forceNewFile: true,
    });
    const editor = vscode.window.activeTextEditor!;
    const mh = (await getAndUpdateModeHandler())!;
    await keys(['i']);
    editor.selections = [new vscode.Selection(1, 0, 1, 0)];
    mh.syncCursors();
    await command('type', { text: '(' });
    assert.strictEqual(editor.document.lineAt(1).text, '()');
    editor.selections = [
      new vscode.Selection(0, 2, 0, 2),
      new vscode.Selection(1, 1, 1, 1),
      new vscode.Selection(2, 2, 2, 2),
      new vscode.Selection(3, 5, 3, 5),
    ];
    mh.syncCursors();
    await keys(['<BS>']);
    // Explicitly resetting cursors clears native auto-closing tracking, so the
    // existing ASCII pair deletes only its opening character, as in VS Code.
    assertEqualLines(['', ')', '', '👩\u200d']);
    assert.strictEqual(mh.vimState.currentMode, Mode.Insert);
    assert.deepStrictEqual(
      editor.selections.map(({ active }) => [active.line, active.character]),
      [
        [0, 0],
        [1, 0],
        [2, 0],
        [3, 3],
      ],
    );
    await command('type', { text: '!' });
    assertEqualLines(['!', '!)', '!', '👩\u200d!']);
  });

  test('counted Replace follows edited cursor offsets on the same line', async () => {
    await setupWorkspace({ fileContent: ['abcdefghij'], forceNewFile: true });
    const editor = vscode.window.activeTextEditor!;
    const mh = (await getAndUpdateModeHandler())!;
    editor.selections = [new vscode.Selection(0, 0, 0, 0), new vscode.Selection(0, 6, 0, 6)];
    mh.syncCursors();
    await keys(['2', 'R']);
    await command('type', { text: '👩\u200d💻' });
    await keys(['<Esc>']);
    assertEqualLines(['👩\u200d💻👩\u200d💻👩\u200d💻👩\u200d💻']);
    assert.deepStrictEqual(
      editor.selections.map(({ active }) => active.character),
      [8, 18],
    );
  });
});
