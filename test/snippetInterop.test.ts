import * as assert from 'assert';
import * as vscode from 'vscode';

import { getAndUpdateModeHandler } from '../extension';
import { Mode } from '../src/mode/mode';
import { ModeHandler } from '../src/mode/modeHandler';
import { taskQueue } from '../src/taskQueue';
import { assertEqualLines, setupWorkspace } from './testUtils';

suite('Snippet input interoperability', () => {
  let modeHandler: ModeHandler;
  let editor: vscode.TextEditor;
  let trace: unknown[];

  const record = (label: string): string => {
    trace.push({
      label,
      mode: modeHandler.vimState.currentMode,
      text: editor.document.getText(),
      selections: editor.selections.map(({ anchor, active }) => ({
        anchor: [anchor.line, anchor.character],
        active: [active.line, active.character],
      })),
    });
    return JSON.stringify(trace);
  };

  const settle = async (): Promise<void> => {
    await new Promise<void>((resolve) => taskQueue.enqueueTask(async () => resolve()));
    // VS Code delivers snippet selection updates separately from command completion.
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    await new Promise<void>((resolve) => taskQueue.enqueueTask(async () => resolve()));
  };

  const command = async (name: string, args?: unknown): Promise<void> => {
    await vscode.commands.executeCommand(name, args);
    await settle();
    record(name);
  };

  const insertSnippet = async (snippet: string): Promise<void> => {
    assert.ok(await editor.insertSnippet(new vscode.SnippetString(snippet)));
    await settle();
    record('insertSnippet');
  };

  setup(async () => {
    await setupWorkspace({ fileContent: [''], forceNewFile: true });
    editor = vscode.window.activeTextEditor!;
    editor.selections = [new vscode.Selection(0, 0, 0, 0)];
    modeHandler = (await getAndUpdateModeHandler())!;
    modeHandler.syncCursors();
    trace = [];
    await command('type', { text: 'i' });
  });

  teardown(async () => {
    await command('leaveSnippet');
  });

  test('Escape leaves snippet navigation inactive in Normal mode', async () => {
    await insertSnippet('prefix ${1:first} ${2:second} suffix$0');
    assert.strictEqual(modeHandler.vimState.currentMode, Mode.Insert, record('after expansion'));
    await command('type', { text: 'one' });
    await command('extension.vim_escape');
    assert.strictEqual(modeHandler.vimState.currentMode, Mode.Normal, record('after Escape'));
    const selection = editor.selection;
    await command('jumpToNextSnippetPlaceholder');
    assert.strictEqual(modeHandler.vimState.currentMode, Mode.Normal, record('Tab after Escape'));
    assert.ok(editor.selection.isEqual(selection), record('inactive snippet selection'));
    assertEqualLines(['prefix one second suffix']);
  });

  test('normal movement and new insertion after Escape do not remain in a snippet', async () => {
    await insertSnippet('prefix ${1:first} ${2:second} suffix$0');
    await command('type', { text: 'one' });
    await command('extension.vim_escape');
    assert.strictEqual(modeHandler.vimState.currentMode, Mode.Normal, record('after Escape'));
    await command('type', { text: 'h' });
    assert.strictEqual(editor.selection.active.character, 8, record('after h'));
    await command('type', { text: 'l' });
    assert.strictEqual(editor.selection.active.character, 9, record('after l'));
    await command('type', { text: 'i' });
    await command('type', { text: 'X' });
    await command('extension.vim_escape');
    assert.strictEqual(
      modeHandler.vimState.currentMode,
      Mode.Normal,
      record('after second Escape'),
    );
    assertEqualLines(['prefix onXe second suffix']);
    const selection = editor.selection;
    await command('jumpToNextSnippetPlaceholder');
    assert.ok(editor.selection.isEqual(selection), record('snippet navigation remains inactive'));
  });

  test('a temporary Normal command preserves snippet navigation on returning to Insert', async () => {
    await insertSnippet('prefix ${1:first} ${2:second} suffix$0');
    await command('type', { text: 'one' });
    const position = editor.selection.active;
    await command('extension.vim_ctrl+o');
    await command('type', { text: 'zz' });
    assert.strictEqual(
      modeHandler.vimState.currentMode,
      Mode.Insert,
      record('after temporary Normal'),
    );
    assert.ok(editor.selection.active.isEqual(position), record('placeholder position unchanged'));
    await command('jumpToNextSnippetPlaceholder');
    assert.strictEqual(
      modeHandler.vimState.currentMode,
      Mode.Insert,
      record('Tab after temporary Normal'),
    );
    assert.strictEqual(
      editor.document.getText(editor.selection),
      'second',
      record('next placeholder'),
    );
    assertEqualLines(['prefix one second suffix']);
  });

  test('smart selection in Insert mode still deliberately enters Visual mode', async () => {
    await command('type', { text: 'someword' });
    editor.selection = new vscode.Selection(0, 3, 0, 3);
    modeHandler.syncCursors();
    await command('editor.action.smartSelect.grow');
    assert.strictEqual(
      modeHandler.vimState.currentMode,
      Mode.Visual,
      record('after smart selection'),
    );
    assert.strictEqual(editor.document.getText(editor.selection), 'someword');
  });
});
