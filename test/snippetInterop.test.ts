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
  let selectionListener: vscode.Disposable | undefined;

  const record = (
    label: string,
    eventKind?: vscode.TextEditorSelectionChangeKind,
    selections = editor.selections,
  ): string => {
    trace.push({
      label,
      eventKind: eventKind ?? null,
      documentVersion: editor.document.version,
      mode: modeHandler.vimState.currentMode,
      text: editor.document.getText(),
      selections: selections.map(({ anchor, active }) => ({
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
    selectionListener = vscode.window.onDidChangeTextEditorSelection((event) => {
      if (event.textEditor.document === editor.document) {
        record('selection change', event.kind, event.selections);
      }
    });
    await command('type', { text: 'i' });
  });

  teardown(async () => {
    try {
      await command('leaveSnippet');
    } finally {
      selectionListener?.dispose();
      if (!editor.document.isClosed) {
        await editor.edit((builder) => builder.setEndOfLine(vscode.EndOfLine.LF));
        await settle();
      }
    }
  });

  test('a linked placeholder at the insertion point stays in Insert mode', async () => {
    await insertSnippet('${1:default}\n${1}');
    assert.strictEqual(modeHandler.vimState.currentMode, Mode.Insert, record('after expansion'));
    assert.strictEqual(editor.selections.length, 2, record('linked selections'));
    await command('type', { text: 'replacement' });
    assertEqualLines(['replacement', 'replacement']);
    assert.strictEqual(modeHandler.vimState.currentMode, Mode.Insert, record('after replacement'));
  });

  test('linked placeholders after a literal prefix remain editable together', async () => {
    await insertSnippet('prefix ${1:first}\n${1}');
    assert.strictEqual(modeHandler.vimState.currentMode, Mode.Insert, record('after expansion'));
    await command('type', { text: 'replacement' });
    assertEqualLines(['prefix replacement', 'replacement']);
    assert.strictEqual(modeHandler.vimState.currentMode, Mode.Insert, record('after replacement'));
  });

  test('Tab to an adjacent placeholder after editing stays in Insert mode', async () => {
    await insertSnippet('prefix ${1:first}${2:second}$0');
    assert.strictEqual(modeHandler.vimState.currentMode, Mode.Insert, record('after expansion'));
    await command('type', { text: 'one' });
    await command('jumpToNextSnippetPlaceholder');
    assert.strictEqual(modeHandler.vimState.currentMode, Mode.Insert, record('after Tab'));
    assert.strictEqual(editor.document.getText(editor.selection), 'second', record('second slot'));
    await command('type', { text: 'two' });
    assertEqualLines(['prefix onetwo']);
  });

  test('Shift-Tab returns to an edited placeholder without leaving Insert mode', async () => {
    await insertSnippet('prefix ${1:first} ${2:second}$0');
    await command('type', { text: 'one' });
    await command('jumpToNextSnippetPlaceholder');
    await command('type', { text: 'two' });
    await command('jumpToPrevSnippetPlaceholder');
    assert.strictEqual(modeHandler.vimState.currentMode, Mode.Insert, record('after Shift-Tab'));
    assert.strictEqual(
      editor.document.getText(editor.selection),
      'one',
      record('first placeholder'),
    );
    await command('type', { text: 'updated' });
    assertEqualLines(['prefix updated two']);
  });

  test('linked placeholders support repeated edits and forward/backward navigation', async () => {
    await insertSnippet('${1:word} ${1} ${2:next}$0');
    assert.strictEqual(modeHandler.vimState.currentMode, Mode.Insert, record('linked expansion'));
    await command('type', { text: 'one' });
    await command('type', { text: '!' });
    assertEqualLines(['one! one! next']);
    await command('jumpToNextSnippetPlaceholder');
    assert.strictEqual(modeHandler.vimState.currentMode, Mode.Insert, record('after linked Tab'));
    assert.strictEqual(editor.selections.length, 1, record('single next placeholder'));
    await command('type', { text: 'end' });
    await command('jumpToPrevSnippetPlaceholder');
    assert.strictEqual(
      modeHandler.vimState.currentMode,
      Mode.Insert,
      record('back to linked slots'),
    );
    assert.strictEqual(editor.selections.length, 2, record('linked selections restored'));
    assert.ok(
      editor.selections.every((selection) => editor.document.getText(selection) === 'one!'),
      record('linked placeholder contents'),
    );
    assertEqualLines(['one! one! end']);
  });

  test('a snippet expanded at two native cursors preserves both input locations', async () => {
    await command('type', { text: 'a\nb' });
    editor.selections = [new vscode.Selection(0, 1, 0, 1), new vscode.Selection(1, 1, 1, 1)];
    await settle();
    modeHandler.syncCursors();
    await insertSnippet('${1:item}:${2:value}$0');
    assert.strictEqual(
      modeHandler.vimState.currentMode,
      Mode.Insert,
      record('multicursor expansion'),
    );
    assert.strictEqual(editor.selections.length, 2, record('first placeholders'));
    await command('type', { text: 'X' });
    await command('jumpToNextSnippetPlaceholder');
    assert.strictEqual(modeHandler.vimState.currentMode, Mode.Insert, record('multicursor Tab'));
    assert.ok(
      editor.selections.every((selection) => editor.document.getText(selection) === 'value'),
      record('second placeholders'),
    );
    await command('type', { text: '42' });
    assertEqualLines(['aX:42', 'bX:42']);
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

  test('smart selection in Insert mode remains available for native replacement', async () => {
    await command('type', { text: 'someword' });
    editor.selection = new vscode.Selection(0, 3, 0, 3);
    modeHandler.syncCursors();
    await command('editor.action.smartSelect.grow');
    assert.strictEqual(
      modeHandler.vimState.currentMode,
      Mode.Insert,
      record('after smart selection'),
    );
    assert.strictEqual(editor.document.getText(editor.selection), 'someword');
    await command('type', { text: 'replacement' });
    assertEqualLines(['replacement']);
    assert.strictEqual(modeHandler.vimState.currentMode, Mode.Insert, record('after replacement'));
  });

  test('smart selection at multiple cursors preserves Insert and replaces every selection', async () => {
    await command('type', { text: 'first second\nfirst third' });
    editor.selections = [new vscode.Selection(0, 2, 0, 2), new vscode.Selection(1, 2, 1, 2)];
    await settle();
    modeHandler.syncCursors();
    await command('editor.action.smartSelect.grow');
    assert.strictEqual(
      modeHandler.vimState.currentMode,
      Mode.Insert,
      record('multicursor selection'),
    );
    assert.strictEqual(editor.selections.length, 2, record('selected cursor count'));
    assert.ok(
      editor.selections.every((selection) => editor.document.getText(selection) === 'first'),
      record('selected words'),
    );
    await command('type', { text: 'X' });
    assertEqualLines(['X second', 'X third']);
    assert.strictEqual(modeHandler.vimState.currentMode, Mode.Insert, record('after replacement'));
  });

  test('smart selection in Normal mode still enters Visual mode', async () => {
    await command('type', { text: 'someword' });
    await command('extension.vim_escape');
    editor.selection = new vscode.Selection(0, 3, 0, 3);
    await settle();
    modeHandler.syncCursors();
    await command('editor.action.smartSelect.grow');
    assert.strictEqual(
      modeHandler.vimState.currentMode,
      Mode.Visual,
      record('Normal smart selection'),
    );
    assert.strictEqual(editor.document.getText(editor.selection), 'someword');
  });

  test('smart selection at multiple Normal cursors still enters Visual mode', async () => {
    await command('type', { text: 'first second\nfirst third' });
    await command('extension.vim_escape');
    editor.selections = [new vscode.Selection(0, 2, 0, 2), new vscode.Selection(1, 2, 1, 2)];
    await settle();
    modeHandler.syncCursors();
    await command('editor.action.smartSelect.grow');
    assert.strictEqual(
      modeHandler.vimState.currentMode,
      Mode.Visual,
      record('Normal multicursor selection'),
    );
    assert.strictEqual(editor.selections.length, 2, record('selected cursor count'));
    assert.ok(
      editor.selections.every((selection) => editor.document.getText(selection) === 'first'),
      record('selected words'),
    );
  });

  test('Select All preserves the native keyboard selection behavior in Normal mode', async () => {
    await command('type', { text: 'alpha beta\ngamma' });
    await command('extension.vim_escape');
    await command('editor.action.selectAll');
    assert.strictEqual(modeHandler.vimState.currentMode, Mode.Normal, record('Normal Select All'));
    assert.strictEqual(editor.document.getText(editor.selection), 'alpha beta\ngamma');
  });

  test('typing replaces the selected snippet placeholder in Replace mode', async () => {
    await command('extension.vim_escape');
    await command('type', { text: 'R' });
    assert.strictEqual(modeHandler.vimState.currentMode, Mode.Replace, record('before expansion'));
    await insertSnippet('prefix ${1:first}${2:second}$0');
    assert.strictEqual(modeHandler.vimState.currentMode, Mode.Replace, record('Replace expansion'));
    assert.strictEqual(
      editor.document.getText(editor.selection),
      'first',
      record('first placeholder'),
    );
    await command('type', { text: 'X' });
    assert.strictEqual(editor.document.getText(), 'prefix Xsecond', record('first replacement'));
    assert.strictEqual(modeHandler.vimState.currentMode, Mode.Replace, record('after first input'));
    await command('jumpToNextSnippetPlaceholder');
    assert.strictEqual(modeHandler.vimState.currentMode, Mode.Replace, record('Replace Tab'));
    assert.strictEqual(
      editor.document.getText(editor.selection),
      'second',
      record('next placeholder'),
    );
    await command('type', { text: 'Y' });
    assert.strictEqual(editor.document.getText(), 'prefix XY', record('second replacement'));
    assert.strictEqual(
      modeHandler.vimState.currentMode,
      Mode.Replace,
      record('after second input'),
    );
    await command('extension.vim_backspace');
    assert.strictEqual(
      editor.document.getText(),
      'prefix Xsecond',
      record('restore second placeholder'),
    );
    assert.strictEqual(modeHandler.vimState.currentMode, Mode.Replace, record('after Backspace'));
  });

  test('Backspace in Replace restores the whole selected placeholder', async () => {
    await command('extension.vim_escape');
    await command('type', { text: 'R' });
    await insertSnippet('prefix ${1:first} suffix$0');
    await command('type', { text: 'X' });
    assert.strictEqual(
      editor.document.getText(),
      'prefix X suffix',
      record('placeholder replacement'),
    );
    await command('extension.vim_backspace');
    assert.strictEqual(
      editor.document.getText(),
      'prefix first suffix',
      record('placeholder restored'),
    );
    assert.strictEqual(editor.selection.active.character, 7, record('restored cursor'));
    assert.strictEqual(modeHandler.vimState.currentMode, Mode.Replace, record('after Backspace'));
  });

  test('Backspace on a new Replace placeholder does not restore an older placeholder', async () => {
    await command('extension.vim_escape');
    await command('type', { text: 'R' });
    await insertSnippet('prefix ${1:first} ${2:second}$0');
    await command('type', { text: 'X' });
    await command('jumpToNextSnippetPlaceholder');
    assert.strictEqual(
      editor.document.getText(editor.selection),
      'second',
      record('new placeholder'),
    );
    await command('extension.vim_backspace');
    // The native typing range contains "second", leaving its leading separator.
    assert.strictEqual(
      editor.document.getText(),
      'prefix X ',
      record('selected placeholder deleted'),
    );
    assert.strictEqual(editor.selection.active.character, 9, record('after selected Backspace'));
    await command('extension.vim_backspace');
    assert.strictEqual(
      editor.document.getText(),
      'prefix X ',
      record('old replacement stays inactive'),
    );
    assert.strictEqual(
      editor.selection.active.character,
      8,
      record('Backspace before new replacement'),
    );
    assert.strictEqual(modeHandler.vimState.currentMode, Mode.Replace, record('after Backspace'));
  });

  test('Escape from Replace leaves snippet navigation inactive in Normal mode', async () => {
    await command('extension.vim_escape');
    await command('type', { text: 'R' });
    await insertSnippet('prefix ${1:first} ${2:second} suffix$0');
    await command('type', { text: 'X' });
    await command('extension.vim_escape');
    assert.strictEqual(
      modeHandler.vimState.currentMode,
      Mode.Normal,
      record('after Replace Escape'),
    );
    const selection = editor.selection;
    await command('jumpToNextSnippetPlaceholder');
    assert.strictEqual(
      modeHandler.vimState.currentMode,
      Mode.Normal,
      record('Tab after Replace Escape'),
    );
    assert.ok(editor.selection.isEqual(selection), record('inactive Replace snippet selection'));
    assert.strictEqual(
      editor.document.getText(),
      'prefix X second suffix',
      record('text after Escape'),
    );
  });

  test('linked Replace ranges keep both cursors aligned when their lengths change', async () => {
    await command('extension.vim_escape');
    await command('type', { text: 'R' });
    await insertSnippet('${1:first} ${1} suffix$0');
    await command('type', { text: 'X' });
    assert.strictEqual(editor.document.getText(), 'X X suffix', record('linked replacement'));
    assert.ok(
      editor.selections.every((selection) => selection.isEmpty),
      record('collapsed cursors'),
    );
    assert.deepStrictEqual(
      editor.selections.map(({ active }) => [active.line, active.character]),
      [
        [0, 1],
        [0, 3],
      ],
      record('replacement cursor positions'),
    );
    await command('extension.vim_backspace');
    assert.strictEqual(
      editor.document.getText(),
      'first first suffix',
      record('linked restoration'),
    );
    assert.deepStrictEqual(
      editor.selections.map(({ active }) => [active.line, active.character]),
      [
        [0, 0],
        [0, 6],
      ],
      record('restored cursor positions'),
    );
    assert.strictEqual(modeHandler.vimState.currentMode, Mode.Replace, record('after Backspace'));
  });

  for (const eol of [vscode.EndOfLine.LF, vscode.EndOfLine.CRLF]) {
    test(`a multiline native Replace range with ${eol === vscode.EndOfLine.LF ? 'LF' : 'CRLF'} is restored by one Backspace`, async () => {
      assert.ok(await editor.edit((builder) => builder.setEndOfLine(eol)));
      await settle();
      const newline = eol === vscode.EndOfLine.LF ? '\n' : '\r\n';
      assert.strictEqual(editor.document.eol, eol, record('requested document EOL'));
      await command('extension.vim_escape');
      await command('type', { text: 'R' });
      await insertSnippet('${1:first' + newline + 'second} suffix$0');
      assert.strictEqual(
        editor.document.getText(editor.selection),
        `first${newline}second`,
        record('multiline range'),
      );
      await command('type', { text: 'X' });
      assert.strictEqual(editor.document.getText(), 'X suffix', record('multiline replacement'));
      assert.ok(
        editor.selection.active.isEqual(new vscode.Position(0, 1)),
        record('replacement cursor'),
      );
      await command('extension.vim_backspace');
      assert.strictEqual(
        editor.document.getText(),
        `first${newline}second suffix`,
        record('multiline restoration'),
      );
      assert.ok(
        editor.selection.active.isEqual(new vscode.Position(0, 0)),
        record('restored cursor'),
      );
      assert.strictEqual(modeHandler.vimState.currentMode, Mode.Replace, record('after Backspace'));
    });
  }

  test('Replace restores differently sized ranges when the primary native selection is last', async () => {
    await command('type', { text: 'alpha MIDDLE tail' });
    await command('extension.vim_escape');
    await command('type', { text: '0R' });
    editor.selections = [new vscode.Selection(0, 12, 0, 6), new vscode.Selection(0, 0, 0, 5)];
    await settle();
    modeHandler.syncCursors();
    assert.ok(editor.selections[0].isReversed, record('reversed primary selection'));
    assert.deepStrictEqual(
      editor.selections.map((selection) => editor.document.getText(selection)),
      ['MIDDLE', 'alpha'],
      record('native selection order'),
    );
    await command('type', { text: 'X' });
    assert.strictEqual(editor.document.getText(), 'X X tail', record('reordered replacements'));
    assert.ok(
      editor.selections.every((selection) => selection.isEmpty),
      record('collapsed cursors'),
    );
    assert.deepStrictEqual(
      editor.selections
        .map(({ active }) => [active.line, active.character])
        .sort((a, b) => a[0] - b[0] || a[1] - b[1]),
      [
        [0, 1],
        [0, 3],
      ],
      record('replacement cursor positions'),
    );
    await command('extension.vim_backspace');
    assert.strictEqual(
      editor.document.getText(),
      'alpha MIDDLE tail',
      record('reordered restoration'),
    );
    assert.deepStrictEqual(
      editor.selections
        .map(({ active }) => [active.line, active.character])
        .sort((a, b) => a[0] - b[0] || a[1] - b[1]),
      [
        [0, 0],
        [0, 6],
      ],
      record('restored cursor positions'),
    );
    assert.strictEqual(modeHandler.vimState.currentMode, Mode.Replace, record('after Backspace'));
  });

  test('Replace keeps a mixed caret and range aligned in reverse native cursor order', async () => {
    await command('type', { text: 'abc\nwxyz' });
    await command('extension.vim_escape');
    await command('type', { text: '0R' });
    editor.selections = [new vscode.Selection(1, 0, 1, 3), new vscode.Selection(0, 0, 0, 0)];
    await settle();
    modeHandler.syncCursors();
    assert.strictEqual(
      modeHandler.vimState.currentMode,
      Mode.Replace,
      record('mixed native selection'),
    );
    await command('type', { text: 'X' });
    assert.strictEqual(editor.document.getText(), 'Xbc\nXz', record('mixed replacements'));
    assert.deepStrictEqual(
      editor.selections
        .map(({ active }) => [active.line, active.character])
        .sort((a, b) => a[0] - b[0] || a[1] - b[1]),
      [
        [0, 1],
        [1, 1],
      ],
      record('replacement cursor positions'),
    );
    await command('extension.vim_backspace');
    assert.strictEqual(editor.document.getText(), 'abc\nwxyz', record('mixed restoration'));
    assert.deepStrictEqual(
      editor.selections
        .map(({ active }) => [active.line, active.character])
        .sort((a, b) => a[0] - b[0] || a[1] - b[1]),
      [
        [0, 0],
        [1, 0],
      ],
      record('restored cursor positions'),
    );
    assert.strictEqual(modeHandler.vimState.currentMode, Mode.Replace, record('after Backspace'));
  });

  test('a reversed native selection in Replace consumes Unicode text and can be restored', async () => {
    await command('type', { text: 'a😀e\u0301z' });
    await command('extension.vim_escape');
    await command('type', { text: '0R' });
    // Native non-mouse selections retain Replace; the next input consumes the
    // selected range once, independently of its direction or UTF-16 length.
    editor.selection = new vscode.Selection(0, 5, 0, 1);
    await settle();
    modeHandler.syncCursors();
    assert.strictEqual(modeHandler.vimState.currentMode, Mode.Replace, record('reverse selection'));
    assert.strictEqual(editor.document.getText(editor.selection), '😀e\u0301');
    await command('type', { text: '🧪' });
    assert.strictEqual(editor.document.getText(), 'a🧪z', record('Unicode replacement'));
    assert.strictEqual(editor.selection.active.character, 3, record('replacement cursor'));
    await command('extension.vim_backspace');
    assert.strictEqual(editor.document.getText(), 'a😀e\u0301z', record('Unicode restored'));
    assert.strictEqual(editor.selection.active.character, 1, record('restored cursor'));
    assert.strictEqual(modeHandler.vimState.currentMode, Mode.Replace, record('after Backspace'));
  });

  test('linked expansion followed immediately by Tab and typing edits the next placeholder', async () => {
    await vscode.commands.executeCommand('editor.action.insertSnippet', {
      snippet: '${1:left} ${1} ${2:right}$0',
    });
    await vscode.commands.executeCommand('jumpToNextSnippetPlaceholder');
    await vscode.commands.executeCommand('type', { text: 'X' });
    await settle();
    assert.strictEqual(
      modeHandler.vimState.currentMode,
      Mode.Insert,
      record('rapid snippet input'),
    );
    assertEqualLines(['left left X']);
  });

  test('immediate consecutive typing preserves both linked placeholder cursors', async () => {
    await vscode.commands.executeCommand('editor.action.insertSnippet', {
      snippet: '${1:left} ${1}$0',
    });
    await vscode.commands.executeCommand('type', { text: 'A' });
    await vscode.commands.executeCommand('type', { text: 'B' });
    await settle();
    assert.strictEqual(modeHandler.vimState.currentMode, Mode.Insert, record('rapid linked input'));
    assert.strictEqual(editor.selections.length, 2, record('linked cursor count'));
    assert.strictEqual(editor.document.getText(), 'AB AB', record('linked replacements'));
  });

  test('Select All in Insert mode remains available for native replacement', async () => {
    await command('type', { text: 'alpha beta\ngamma' });
    await command('editor.action.selectAll');
    assert.strictEqual(modeHandler.vimState.currentMode, Mode.Insert, record('Insert Select All'));
    await command('type', { text: 'replacement' });
    assertEqualLines(['replacement']);
    assert.strictEqual(modeHandler.vimState.currentMode, Mode.Insert, record('after replacement'));
  });

  test('ordinary keyboard selection still replaces text in Insert mode', async () => {
    await command('type', { text: 'alpha beta' });
    editor.selection = new vscode.Selection(0, 2, 0, 2);
    await settle();
    modeHandler.syncCursors();
    await command('cursorRightSelect');
    assert.strictEqual(modeHandler.vimState.currentMode, Mode.Insert, record('keyboard selection'));
    assert.strictEqual(
      editor.document.getText(editor.selection),
      'p',
      record('selected character'),
    );
    await command('type', { text: 'X' });
    assertEqualLines(['alXha beta']);
    assert.strictEqual(modeHandler.vimState.currentMode, Mode.Insert, record('after replacement'));
  });

  test('a reversed keyboard selection still replaces text in Insert mode', async () => {
    await command('type', { text: 'alpha beta' });
    editor.selection = new vscode.Selection(0, 5, 0, 5);
    await settle();
    modeHandler.syncCursors();
    await command('cursorLeftSelect');
    assert.strictEqual(modeHandler.vimState.currentMode, Mode.Insert, record('reverse selection'));
    assert.ok(editor.selection.isReversed, record('backward selection direction'));
    assert.strictEqual(
      editor.document.getText(editor.selection),
      'a',
      record('selected character'),
    );
    await command('type', { text: 'X' });
    assertEqualLines(['alphX beta']);
    assert.strictEqual(modeHandler.vimState.currentMode, Mode.Insert, record('after replacement'));
  });
});
