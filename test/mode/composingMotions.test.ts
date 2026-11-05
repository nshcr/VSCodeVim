import * as assert from 'assert';
import * as vscode from 'vscode';

import { getAndUpdateModeHandler } from '../../extension';
import { ModeHandler } from '../../src/mode/modeHandler';
import { taskQueue } from '../../src/taskQueue';
import { assertEqualLines, setupWorkspace } from '../testUtils';

suite('Vim composing character motions', () => {
  let modeHandler: ModeHandler;

  const reset = async (lines: string[], whichwrap = 'b,s'): Promise<void> => {
    await setupWorkspace({ fileContent: lines, forceNewFile: true, config: { whichwrap } });
    vscode.window.activeTextEditor!.selections = [new vscode.Selection(0, 0, 0, 0)];
    modeHandler = (await getAndUpdateModeHandler())!;
    modeHandler.syncCursors();
  };

  const type = async (text: string): Promise<void> => {
    await vscode.commands.executeCommand('type', { text });
    await new Promise<void>((resolve) => taskQueue.enqueueTask(async () => resolve()));
  };

  const assertCursor = (line: number, character: number): void => {
    assert.ok(
      modeHandler.vimState.cursorStopPosition.isEqual(new vscode.Position(line, character)),
    );
    assert.ok(
      modeHandler.vimState.editor.selection.active.isEqual(new vscode.Position(line, character)),
    );
  };

  for (const text of ['e\u0301', 'a\u0301\u0308']) {
    test(`h and l move over the base and all composing marks: ${JSON.stringify(text)}`, async () => {
      await reset([`${text}abc`]);
      await type('l');
      assertCursor(0, text.length);
      await type('h');
      assertCursor(0, 0);
    });

    test(`x removes the base and all composing marks: ${JSON.stringify(text)}`, async () => {
      await reset([`${text}abc`]);
      await type('x');
      assertEqualLines(['abc']);
      assertCursor(0, 0);
    });

    test(`X removes the previous complete composing character: ${JSON.stringify(text)}`, async () => {
      await reset([`${text}abc`]);
      modeHandler.vimState.editor.selection = new vscode.Selection(0, text.length, 0, text.length);
      modeHandler.syncCursors();
      await type('X');
      assertEqualLines(['abc']);
      assertCursor(0, 0);
    });
  }

  test('a count deletes Vim characters rather than individual combining marks', async () => {
    await reset(['e\u0301a\u0308z']);
    await type('2');
    await type('x');
    assertEqualLines(['z']);
    assertCursor(0, 0);
  });

  test('l at the last composing character stays on its base', async () => {
    await reset(['e\u0301']);
    await type('l');
    assertCursor(0, 0);
  });

  test('deleting the final plain character leaves the cursor on the previous base', async () => {
    await reset(['e\u0301x']);
    modeHandler.vimState.editor.selection = new vscode.Selection(0, 2, 0, 2);
    modeHandler.syncCursors();
    await type('x');
    assertEqualLines(['e\u0301']);
    assertCursor(0, 0);
  });

  test('whichwrap crosses a complete final composing character in both directions', async () => {
    await reset(['e\u0301', 'a'], 'h,l');
    await type('l');
    assertCursor(1, 0);
    await type('h');
    assertCursor(0, 0);
  });

  test('ZWJ remains a separate Vim character between emoji components', async () => {
    await reset(['👩\u200d💻abc']);
    await type('l');
    assertCursor(0, 2);
    await type('l');
    assertCursor(0, 3);
    await type('h');
    assertCursor(0, 2);
    await type('h');
    assertCursor(0, 0);
    await type('2');
    await type('x');
    assertEqualLines(['💻abc']);
  });

  test('variation selectors follow their base while ZWJ stays separate', async () => {
    await reset(['🏳️\u200d🌈abc']);
    await type('l');
    assertCursor(0, 3);
    await type('h');
    assertCursor(0, 0);
    await type('x');
    assertEqualLines(['\u200d🌈abc']);
  });

  test('skin-tone modifiers remain separate Vim characters', async () => {
    await reset(['👍🏽abc']);
    await type('l');
    assertCursor(0, 2);
    await type('h');
    await type('x');
    assertEqualLines(['🏽abc']);
  });

  test('spacing combining marks are not attached as Vim composing characters', async () => {
    await reset(['काabc']);
    await type('l');
    assertCursor(0, 1);
    await type('h');
    await type('x');
    assertEqualLines(['ाabc']);
  });
});
