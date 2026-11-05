import * as assert from 'assert';
import * as vscode from 'vscode';

import { getAndUpdateModeHandler } from '../extension';
import { HistoryTracker } from '../src/history/historyTracker';
import { newTest, newTestWithRemaps } from './testSimplifier';
import { setupWorkspace } from './testUtils';

suite('History step merge', () => {
  setup(async () => {
    await setupWorkspace({ forceNewFile: true });
  });

  newTest({
    title: 'redo preserves nested insertion order during macro playback',
    start: ['|12'],
    keysPressed: 'qaiABC<Esc>hhiXY<Esc>q@au<C-r>',
    end: ['X|XYABCYABC12'],
  });

  newTestWithRemaps({
    title: 'redo preserves change and put inside one mapping',
    start: ['|word'],
    remaps: ['nmap X ciw[]<Esc>P'],
    steps: [{ keysPressed: 'Xu<C-r>', stepResult: { end: ['|[word]'] } }],
  });

  type Edit = { offset: number; length?: number; text: string };

  const editStep = async (initial: string, edits: Edit[], eol = vscode.EndOfLine.LF) => {
    const editor = vscode.window.activeTextEditor!;
    await editor.edit((builder) => {
      builder.replace(
        new vscode.Range(new vscode.Position(0, 0), editor.document.positionAt(Infinity)),
        initial,
      );
      builder.setEndOfLine(eol);
    });
    const modeHandler = (await getAndUpdateModeHandler())!;
    const tracker = new HistoryTracker(modeHandler.vimState);
    tracker.addMark(
      editor.document,
      new vscode.Position(0, initial.split('\n')[0].length - 1),
      'a',
    );
    for (const edit of edits) {
      const start = editor.document.positionAt(edit.offset);
      const end = editor.document.positionAt(edit.offset + (edit.length ?? 0));
      await editor.edit((builder) => builder.replace(new vscode.Range(start, end), edit.text));
      tracker.addChange(true);
    }
    tracker.finishCurrentStep();
    return { editor, tracker };
  };

  for (const scenario of [
    {
      title: 'an insertion inside earlier inserted text',
      edits: [
        { offset: 0, text: 'ABC' },
        { offset: 1, text: 'XY' },
      ],
      final: 'AXYBC12',
    },
    {
      title: 'a deletion inside earlier inserted text',
      edits: [
        { offset: 0, text: 'abcdef' },
        { offset: 2, length: 3, text: '' },
      ],
      final: 'abf12',
    },
    {
      title: 'two insertions at the same position',
      edits: [
        { offset: 0, text: 'ABC' },
        { offset: 0, text: 'XY' },
      ],
      final: 'XYABC12',
    },
    {
      title: 'a deletion containing both inserted and original text',
      edits: [
        { offset: 1, text: 'ABC' },
        { offset: 0, length: 5, text: '' },
      ],
      final: '',
    },
    {
      title: 'non-BMP and combining text at an interior boundary',
      edits: [
        { offset: 0, text: '👩‍💻é' },
        { offset: 2, text: '🧪' },
      ],
      final: '👩🧪‍💻é12',
    },
  ]) {
    test(`undo and redo ${scenario.title}`, async () => {
      const { editor, tracker } = await editStep('12', scenario.edits);
      assert.strictEqual(editor.document.getText(), scenario.final);
      await tracker.goBackHistoryStep();
      assert.strictEqual(editor.document.getText(), '12');
      await tracker.goForwardHistoryStep();
      assert.strictEqual(editor.document.getText(), scenario.final);
    });
  }

  for (const eol of [vscode.EndOfLine.LF, vscode.EndOfLine.CRLF]) {
    test(`undo and redo interior multiline edits with ${eol === vscode.EndOfLine.LF ? 'LF' : 'CRLF'}`, async () => {
      const newline = eol === vscode.EndOfLine.LF ? '\n' : '\r\n';
      const initial = `12${newline}34`;
      const first = `A${newline}B`;
      const { editor, tracker } = await editStep(
        initial,
        [
          { offset: 0, text: first },
          { offset: first.length, text: `X${newline}Y` },
        ],
        eol,
      );
      const final = `A${newline}BX${newline}Y12${newline}34`;
      assert.strictEqual(editor.document.getText(), final);
      await tracker.goBackHistoryStep();
      assert.strictEqual(editor.document.getText(), initial);
      await tracker.goForwardHistoryStep();
      assert.strictEqual(editor.document.getText(), final);
    });
  }

  test('a cancelling insertion and deletion remains safe to finish, undo and redo', async () => {
    const { editor, tracker } = await editStep('12', [
      { offset: 0, text: 'ABC' },
      { offset: 0, length: 3, text: '' },
    ]);
    assert.strictEqual(editor.document.getText(), '12');
    await tracker.goBackHistoryStep();
    assert.strictEqual(editor.document.getText(), '12');
    await tracker.goForwardHistoryStep();
    assert.strictEqual(editor.document.getText(), '12');
  });

  test('marks follow nested insertions and return on undo', async () => {
    const { tracker } = await editStep('12', [
      { offset: 0, text: 'ABC' },
      { offset: 1, text: 'XY' },
    ]);
    assert.strictEqual(tracker.getMark('a')?.position.character, 6);
    await tracker.goBackHistoryStep();
    assert.strictEqual(tracker.getMark('a')?.position.character, 1);
    await tracker.goForwardHistoryStep();
    assert.strictEqual(tracker.getMark('a')?.position.character, 6);
  });

  test('U and UU retain their line restoration behavior for nested edits', async () => {
    const { editor, tracker } = await editStep('12', [
      { offset: 0, text: 'ABC' },
      { offset: 1, text: 'XY' },
    ]);
    await tracker.goBackHistoryStepsOnLine();
    assert.strictEqual(editor.document.getText(), '12');
    await tracker.goBackHistoryStepsOnLine();
    assert.strictEqual(editor.document.getText(), 'AXYBC12');
  });

  test('undo and redo preserve the execution order of a multi-change U step', async () => {
    const { editor, tracker } = await editStep('12', [
      { offset: 0, text: 'ABC' },
      { offset: 1, text: 'XY' },
    ]);
    await tracker.goBackHistoryStepsOnLine();
    assert.strictEqual(editor.document.getText(), '12');
    await tracker.goBackHistoryStep();
    assert.strictEqual(editor.document.getText(), 'AXYBC12');
    await tracker.goForwardHistoryStep();
    assert.strictEqual(editor.document.getText(), '12');
  });

  test('U and UU preserve separate edits whose offsets move during restoration', async () => {
    const { editor, tracker } = await editStep('one two three', [
      { offset: 8, length: 5, text: '3' },
      { offset: 0, length: 3, text: '1' },
    ]);
    assert.strictEqual(editor.document.getText(), '1 two 3');
    await tracker.goBackHistoryStepsOnLine();
    assert.strictEqual(editor.document.getText(), 'one two three');
    await tracker.goBackHistoryStepsOnLine();
    assert.strictEqual(editor.document.getText(), '1 two 3');
  });
});
