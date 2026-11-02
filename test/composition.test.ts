import * as assert from 'assert';
import * as vscode from 'vscode';

import { getAndUpdateModeHandler } from '../extension';
import { Mode } from '../src/mode/mode';
import { ModeHandler } from '../src/mode/modeHandler';
import { taskQueue } from '../src/taskQueue';
import { assertEqualLines, setupWorkspace } from './testUtils';

suite('IME composition', () => {
  let modeHandler: ModeHandler;

  // Command overrides enqueue their work rather than returning its promise.
  const command = async (name: string, args?: unknown): Promise<void> => {
    await vscode.commands.executeCommand(name, args);
    await new Promise<void>((resolve) => {
      taskQueue.enqueueTask(async () => resolve());
    });
  };

  const insertAt = async (...positions: Array<[number, number]>): Promise<void> => {
    await modeHandler.handleKeyEvent('i');
    modeHandler.vimState.editor.selections = positions.map(
      ([line, character]) => new vscode.Selection(line, character, line, character),
    );
    modeHandler.syncCursors();
  };

  const assertCursors = (...positions: Array<[number, number]>): void => {
    assert.deepStrictEqual(
      modeHandler.vimState.editor.selections.map(({ active }) => [active.line, active.character]),
      positions,
      'Editor cursors',
    );
    assert.deepStrictEqual(
      modeHandler.vimState.cursors.map(({ stop }) => [stop.line, stop.character]),
      positions,
      'Vim cursors',
    );
    assert.strictEqual(modeHandler.vimState.currentMode, Mode.Insert);
  };

  setup(async () => {
    await setupWorkspace({ fileContent: ['one', 'two', 'three'] });
    modeHandler = (await getAndUpdateModeHandler())!;
  });

  teardown(async () => {
    await command('compositionEnd');
  });

  test('commits a Chinese phrase at every cursor and continues typing', async () => {
    await insertAt([0, 0], [1, 1], [2, 3]);
    await command('compositionStart');
    await command('type', { text: 'nihao' });
    await command('replacePreviousChar', { text: '你好', replaceCharCnt: 5 });
    assertEqualLines(['你好one', 't你好wo', 'thr你好ee']);
    assertCursors([0, 2], [1, 3], [2, 5]);
    await command('compositionEnd');
    assertEqualLines(['你好one', 't你好wo', 'thr你好ee']);
    assertCursors([0, 2], [1, 3], [2, 5]);
    await command('type', { text: '!' });
    assertEqualLines(['你好!one', 't你好!wo', 'thr你好!ee']);
    assertCursors([0, 3], [1, 4], [2, 6]);
  });

  test('handles cursors on the same line with the primary cursor last', async () => {
    await insertAt([0, 3], [0, 0]);
    await command('compositionStart');
    await command('type', { text: 'zhong' });
    await command('replacePreviousChar', { text: '中文', replaceCharCnt: 5 });
    await command('compositionEnd');
    assertEqualLines(['中文one中文', 'two', 'three']);
    assertCursors([0, 7], [0, 2]);
  });

  test('supports successive compositions and partial candidate replacements', async () => {
    await insertAt([0, 0], [1, 0]);
    await command('compositionStart');
    await command('type', { text: 'ni' });
    await command('replacePreviousChar', { text: '你', replaceCharCnt: 2 });
    await command('type', { text: 'hao' });
    await command('replacePreviousChar', { text: '好', replaceCharCnt: 3 });
    await command('compositionEnd');
    await command('compositionStart');
    await command('type', { text: 'shijie' });
    await command('replacePreviousChar', { text: '世界', replaceCharCnt: 6 });
    await command('compositionEnd');
    assertEqualLines(['你好世界one', '你好世界two', 'three']);
    assertCursors([0, 4], [1, 4]);
  });

  for (const positions of [
    [[0, 0]],
    [
      [0, 1],
      [1, 2],
    ],
  ] satisfies Array<Array<[number, number]>>) {
    test(`cancels composition with ${positions.length} cursor(s)`, async () => {
      await insertAt(...positions);
      await command('compositionStart');
      await command('type', { text: 'ni' });
      await command('replacePreviousChar', { text: '', replaceCharCnt: 2 });
      assertCursors(...positions);
      await command('compositionEnd');
      assertEqualLines(['one', 'two', 'three']);
      assertCursors(...positions);
    });
  }

  test('supports composition in visual block insert mode', async () => {
    await modeHandler.handleMultipleKeyEvents(['g', 'g', '0', '<C-v>', 'j', 'j', 'I']);
    await command('compositionStart');
    await command('type', { text: 'nihao' });
    await command('replacePreviousChar', { text: '你好', replaceCharCnt: 5 });
    await command('compositionEnd');
    assertEqualLines(['你好one', '你好two', '你好three']);
    assertCursors([0, 2], [1, 2], [2, 2]);
  });
});
