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

  test('commits a candidate replacing preedit on both sides of the caret (#10111)', async () => {
    await insertAt([0, 0], [1, 0]);
    await command('compositionStart');
    await command('type', { text: 'hh' });
    await command('compositionType', {
      text: 'hh提示',
      replacePrevCharCnt: 2,
      replaceNextCharCnt: 0,
      positionDelta: -2,
    });
    await command('compositionType', {
      text: '哈哈',
      replacePrevCharCnt: 2,
      replaceNextCharCnt: 2,
      positionDelta: 0,
    });
    await command('compositionEnd');
    assertEqualLines(['哈哈one', '哈哈two', 'three']);
    assertCursors([0, 2], [1, 2]);
  });

  test('cancels marked text after the caret without replaying it (#10120)', async () => {
    await insertAt([0, 0]);
    await command('compositionStart');
    await command('type', { text: '\u200b' });
    await command('compositionType', {
      text: '',
      replacePrevCharCnt: 0,
      replaceNextCharCnt: 0,
      positionDelta: -1,
    });
    await command('compositionType', {
      text: '',
      replacePrevCharCnt: 0,
      replaceNextCharCnt: 1,
      positionDelta: 0,
    });
    await command('compositionEnd');
    assertEqualLines(['one', 'two', 'three']);
    assertCursors([0, 0]);
  });

  test('tracks insertion inside preedit and preserves the IME caret', async () => {
    await insertAt([0, 0]);
    await command('compositionStart');
    await command('type', { text: 'ab' });
    await command('compositionType', {
      text: '',
      replacePrevCharCnt: 0,
      replaceNextCharCnt: 0,
      positionDelta: -1,
    });
    await command('type', { text: 'X' });
    await command('compositionEnd');
    assertEqualLines(['aXbone', 'two', 'three']);
    assertCursors([0, 2]);
    await command('type', { text: '!' });
    assertEqualLines(['aX!bone', 'two', 'three']);
  });

  test('supports compositionType as the first preedit event and commits an emoji', async () => {
    await insertAt([0, 3], [0, 0]);
    await command('compositionStart');
    await command('compositionType', {
      text: 'hh提示',
      replacePrevCharCnt: 0,
      replaceNextCharCnt: 0,
      positionDelta: -2,
    });
    await command('compositionType', {
      text: '😀',
      replacePrevCharCnt: 2,
      replaceNextCharCnt: 2,
      positionDelta: 0,
    });
    await command('compositionEnd');
    assertEqualLines(['😀one😀', 'two', 'three']);
    assertCursors([0, 7], [0, 2]);
  });

  test('does not write Korean preedit into the document in Normal mode (#9863)', async () => {
    await command('compositionStart');
    await command('type', { text: 'ㅎ' });
    await command('compositionType', {
      text: '한',
      replacePrevCharCnt: 1,
      replaceNextCharCnt: 0,
      positionDelta: -1,
    });
    await command('compositionType', {
      text: '',
      replacePrevCharCnt: 0,
      replaceNextCharCnt: 0,
      positionDelta: 1,
    });
    await command('compositionEnd');
    assertEqualLines(['one', 'two', 'three']);
    assert.strictEqual(modeHandler.vimState.currentMode, Mode.Normal);
  });

  test('undoes and redoes a compositionType commit as inserted text', async () => {
    await insertAt([0, 0]);
    await command('compositionStart');
    await command('type', { text: 'hh' });
    await command('compositionType', {
      text: '哈哈',
      replacePrevCharCnt: 2,
      replaceNextCharCnt: 0,
      positionDelta: 0,
    });
    await command('compositionEnd');
    await modeHandler.handleMultipleKeyEvents(['<Esc>', 'u']);
    assertEqualLines(['one', 'two', 'three']);
    await modeHandler.handleKeyEvent('<C-r>');
    assertEqualLines(['哈哈one', 'two', 'three']);
  });

  test('keeps composition updates in the Ex command line (#9975)', async () => {
    await modeHandler.handleMultipleKeyEvents([':', 's', '/']);
    await command('compositionStart');
    await command('type', { text: 'zhong' });
    await command('compositionType', {
      text: '中文',
      replacePrevCharCnt: 5,
      replaceNextCharCnt: 0,
      positionDelta: -1,
    });
    await command('compositionType', {
      text: '',
      replacePrevCharCnt: 0,
      replaceNextCharCnt: 0,
      positionDelta: 1,
    });
    await command('compositionEnd');
    assertEqualLines(['one', 'two', 'three']);
    assert.strictEqual(modeHandler.vimState.modeData.mode, Mode.CommandlineInProgress);
    if (modeHandler.vimState.modeData.mode === Mode.CommandlineInProgress) {
      assert.strictEqual(modeHandler.vimState.modeData.commandLine.text, 's/中文');
    }
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
