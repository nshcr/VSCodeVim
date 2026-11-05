import * as assert from 'assert';
import * as vscode from 'vscode';

import { getAndUpdateModeHandler } from '../extension';
import { Mode } from '../src/mode/mode';
import { taskQueue } from '../src/taskQueue';
import { setupWorkspace } from './testUtils';

suite('Native undo interoperability', () => {
  let trace: unknown[];
  let changeListener: vscode.Disposable;

  const record = async (label: string): Promise<string> => {
    const editor = vscode.window.activeTextEditor!;
    const handler = (await getAndUpdateModeHandler())!;
    trace.push({
      label,
      document: editor.document.uri.toString(),
      version: editor.document.version,
      text: editor.document.getText(),
      mode: handler.vimState.currentMode,
      selections: editor.selections.map(({ anchor, active }) => ({
        anchor: [anchor.line, anchor.character],
        active: [active.line, active.character],
      })),
    });
    return JSON.stringify(trace);
  };

  const drain = async (): Promise<void> => {
    await new Promise<void>((resolve) => taskQueue.enqueueTask(async () => resolve()));
    // Native undo can deliver its selection update after the command resolves.
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    await new Promise<void>((resolve) => taskQueue.enqueueTask(async () => resolve()));
  };

  const command = async (name: string, args?: unknown): Promise<void> => {
    await vscode.commands.executeCommand(name, args);
    await drain();
    await record(name);
  };
  const type = async (text: string): Promise<void> => command('type', { text });
  const insert = async (text: string): Promise<void> => {
    await type(`i${text}`);
    await command('extension.vim_escape');
  };
  const expectText = async (text: string): Promise<void> => {
    assert.strictEqual(
      vscode.window.activeTextEditor!.document.getText(),
      text,
      await record('assert text'),
    );
  };

  const open = async (lines = ['ab']): Promise<vscode.TextEditor> => {
    await setupWorkspace({ fileContent: lines, forceNewFile: true });
    const editor = vscode.window.activeTextEditor!;
    editor.selections = [new vscode.Selection(0, 0, 0, 0)];
    const handler = (await getAndUpdateModeHandler())!;
    handler.syncCursors();
    return editor;
  };

  // editor.edit's default undo stops make this a real, separate native undo
  // element. A harmless Vim motion then records the external edit in Vim history.
  const externalInsert = async (text: string, line = 0, character = 0): Promise<void> => {
    const editor = vscode.window.activeTextEditor!;
    assert.ok(
      await editor.edit((builder) => builder.insert(new vscode.Position(line, character), text)),
    );
    await drain();
    await type('0');
  };

  setup(async () => {
    trace = [];
    await open();
    changeListener = vscode.workspace.onDidChangeTextDocument((event) => {
      if (event.contentChanges.length > 0) {
        trace.push({
          label: 'document change',
          document: event.document.uri.toString(),
          version: event.document.version,
          reason: event.reason,
          text: event.document.getText(),
        });
      }
    });
  });

  teardown(() => {
    changeListener.dispose();
  });

  test('Vim u does not reapply a whole native typing group and redo retains both Vim steps', async () => {
    await insert('X');
    await insert('Y');
    await expectText('YXab');
    await command('undo');
    await expectText('ab');
    await type('u');
    await expectText('ab');
    await command('extension.vim_ctrl+r');
    await expectText('Xab');
    await command('extension.vim_ctrl+r');
    await expectText('YXab');
  });

  test('native undo and redo returning to the same text do not create a new Vim edit', async () => {
    await insert('X');
    await insert('Y');
    await command('undo');
    await expectText('ab');
    await command('redo');
    await expectText('YXab');
    await type('u');
    await expectText('Xab');
    await type('u');
    await expectText('ab');
  });

  test('new typing after native undo replaces the old redo branch', async () => {
    await insert('X');
    await insert('Y');
    await command('undo');
    await expectText('ab');
    await insert('Z');
    await expectText('Zab');
    await type('u');
    await expectText('ab');
    await command('extension.vim_ctrl+r');
    await expectText('Zab');
    await command('extension.vim_ctrl+r');
    await expectText('Zab');
  });

  test('native undo of a Vim u aligns forward instead of trusting the native reason direction', async () => {
    await insert('X');
    await insert('Y');
    await type('u');
    await expectText('Xab');
    await command('undo');
    await expectText('YXab');
    await type('u');
    await expectText('Xab');
  });

  test('native undo while inserting does not become new text to restore on Vim u', async () => {
    await insert('X');
    await type('iY');
    await expectText('YXab');
    await command('undo');
    await expectText('ab');
    await command('extension.vim_escape');
    assert.strictEqual(
      (await getAndUpdateModeHandler())!.vimState.currentMode,
      Mode.Normal,
      await record('after Escape'),
    );
    await type('u');
    await expectText('ab');
  });

  test('a pending native undo is isolated from a second document', async () => {
    const first = vscode.window.activeTextEditor!;
    await insert('X');
    await insert('Y');
    await command('undo');
    await expectText('ab');

    const second = await vscode.window.showTextDocument(
      await vscode.workspace.openTextDocument({ content: 'cd', language: 'plaintext' }),
    );
    await drain();
    second.selections = [new vscode.Selection(0, 0, 0, 0)];
    (await getAndUpdateModeHandler())!.syncCursors();
    await insert('Q');
    await expectText('Qcd');
    await type('u');
    await expectText('cd');

    await vscode.window.showTextDocument(first.document);
    await drain();
    await type('u');
    await expectText('ab');
    assert.strictEqual(second.document.getText(), 'cd', await record('second document unchanged'));
  });

  test('Vim u continues after one explicitly separated native undo step', async () => {
    await externalInsert('X');
    await externalInsert('Y');
    await expectText('YXab');
    await command('undo');
    await expectText('Xab');
    await type('u');
    await expectText('ab');
    await command('extension.vim_ctrl+r');
    await expectText('Xab');
    await command('extension.vim_ctrl+r');
    await expectText('YXab');
  });

  test('consecutive native undos before a Vim key retain the original redo sequence', async () => {
    await externalInsert('X');
    await externalInsert('Y');
    await command('undo');
    await expectText('Xab');
    await command('undo');
    await expectText('ab');
    await type('u');
    await expectText('ab');
    await command('extension.vim_ctrl+r');
    await expectText('Xab');
    await command('extension.vim_ctrl+r');
    await expectText('YXab');
  });

  test('multiline Unicode changes retain UTF-16 positions across native and Vim undo', async () => {
    await open(['ab', 'cd']);
    await externalInsert('👩\u200d💻e\u0301\n');
    await externalInsert('🧪', 1);
    await expectText('👩\u200d💻e\u0301\n🧪ab\ncd');
    await command('undo');
    await expectText('👩\u200d💻e\u0301\nab\ncd');
    await type('u');
    await expectText('ab\ncd');
    await command('extension.vim_ctrl+r');
    await expectText('👩\u200d💻e\u0301\nab\ncd');
    await command('extension.vim_ctrl+r');
    await expectText('👩\u200d💻e\u0301\n🧪ab\ncd');
  });

  test('an ordinary edit after a native undo remains a separate Vim undo step', async () => {
    await externalInsert('X');
    await externalInsert('Y');
    await command('undo');
    await expectText('Xab');

    const editor = vscode.window.activeTextEditor!;
    assert.ok(await editor.edit((builder) => builder.delete(new vscode.Range(0, 0, 0, 1))));
    await drain();
    await record('ordinary deletion after native undo without a Vim key');
    await expectText('ab');

    await type('u');
    await expectText('Xab');
    await type('u');
    await expectText('ab');
  });

  test('a native undo inside one Vim step establishes a safe boundary without changing native redo', async () => {
    await type('iX');
    const editor = vscode.window.activeTextEditor!;
    assert.ok(await editor.edit((builder) => builder.insert(new vscode.Position(0, 1), 'Y')));
    await drain();
    await command('extension.vim_escape');
    await expectText('XYab');

    await command('undo');
    await expectText('Xab');
    await type('u');
    await expectText('Xab');
    await command('extension.vim_ctrl+r');
    await expectText('Xab');
    await command('redo');
    await expectText('XYab');
  });

  test('repeated text at two history boundaries does not make Vim guess a history direction', async () => {
    await externalInsert('X');
    await externalInsert('Y');
    const editor = vscode.window.activeTextEditor!;
    assert.ok(await editor.edit((builder) => builder.delete(new vscode.Range(0, 0, 0, 1))));
    await drain();
    await type('0');
    await expectText('Xab');

    // The first target is unique. The second target has the same text at a
    // past and a future Vim boundary, so neither direction is provable.
    await command('undo');
    await expectText('YXab');
    await command('undo');
    await expectText('Xab');
    await type('u');
    await expectText('Xab');
    await command('extension.vim_ctrl+r');
    await expectText('Xab');

    await type('0');
    await insert('Z');
    await expectText('ZXab');
    await type('u');
    await expectText('Xab');
    await command('extension.vim_ctrl+r');
    await expectText('ZXab');
  });

  test('native and Vim undo keep all multicursor insertion rows consistent', async () => {
    const editor = await open(['ab', 'cd']);
    editor.selections = [new vscode.Selection(0, 0, 0, 0), new vscode.Selection(1, 0, 1, 0)];
    (await getAndUpdateModeHandler())!.syncCursors();
    await insert('X');
    await expectText('Xab\nXcd');
    await insert('Y');
    await expectText('YXab\nYXcd');

    await command('undo');
    // Native typing groups are editor-owned. Either one or both insertions
    // can be undone together, but the result must agree on both cursor rows.
    assert.ok(
      ['ab\ncd', 'Xab\nXcd'].includes(editor.document.getText()),
      await record('native multicursor undo group'),
    );
    await type('u');
    await expectText('ab\ncd');
    await command('extension.vim_ctrl+r');
    await expectText('Xab\nXcd');
    await command('extension.vim_ctrl+r');
    await expectText('YXab\nYXcd');
    assert.deepStrictEqual(
      editor.selections.map((selection) => selection.active.line).sort(),
      [0, 1],
      await record('both cursors restored'),
    );
  });

  test('a safe history boundary preserves local marks, native redo and later Vim edits', async () => {
    const editor = vscode.window.activeTextEditor!;
    const expectMark = async (character: number): Promise<void> => {
      const mark = (await getAndUpdateModeHandler())!.vimState.historyTracker.getMark('a');
      assert.ok(mark, await record('local mark exists'));
      assert.ok(
        mark.position.isEqual(new vscode.Position(0, character)),
        await record('local mark position'),
      );
      assert.strictEqual(
        editor.document.getText(new vscode.Range(mark.position, mark.position.translate(0, 1))),
        'a',
        await record('local mark still tracks its original character'),
      );
    };

    await type('ma');
    await type('iX');
    assert.ok(await editor.edit((builder) => builder.insert(new vscode.Position(0, 1), 'Y')));
    await drain();
    await command('extension.vim_escape');
    await expectText('XYab');
    await expectMark(2);

    await command('undo');
    await expectText('Xab');
    await type('u');
    await expectText('Xab');
    await expectMark(1);
    await command('extension.vim_ctrl+r');
    await expectText('Xab');
    await expectMark(1);

    await command('redo');
    await expectText('XYab');
    // A normal motion consumes the native redo snapshot before querying the
    // lazy Vim history's marks and beginning an unrelated edit.
    await type('0');
    await expectMark(2);
    await insert('Z');
    await expectText('ZXYab');
    await expectMark(3);
    await type('u');
    await expectText('XYab');
    await expectMark(2);
    await command('extension.vim_ctrl+r');
    await expectText('ZXYab');
    await expectMark(3);
  });

  for (const flushBeforeUndo of [false, true]) {
    test(`dot repeats only surviving input after native undo (previous changes flushed: ${flushBeforeUndo})`, async () => {
      await insert('X');
      await type('iY');
      if (flushBeforeUndo) {
        await command('extension.vim_ctrl+g');
        await type('u');
      }
      await expectText('YXab');
      await command('undo');
      await expectText('ab');
      assert.strictEqual(
        (await getAndUpdateModeHandler())!.vimState.currentMode,
        Mode.Insert,
        await record('native undo preserves Insert mode'),
      );

      await type('Z');
      await expectText('Zab');
      await command('extension.vim_escape');
      await type('$');
      assert.strictEqual(
        vscode.window.activeTextEditor!.selection.active.character,
        2,
        await record('repeat starts before the final character'),
      );
      await type('.');
      await expectText('ZaZb');
    });
  }
});
