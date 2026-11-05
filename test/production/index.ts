import * as assert from 'assert';
import Mocha from 'mocha';
import * as vscode from 'vscode';

// Exercise the bundled extension through VS Code commands, without importing source modules.
const waitFor = async (condition: () => boolean): Promise<void> => {
  const deadline = Date.now() + 3000;
  while (!condition()) {
    assert.ok(Date.now() < deadline, 'Timed out waiting for the bundled extension');
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
};

const openEditor = async (content = 'one\ntwo\nthree'): Promise<vscode.TextEditor> =>
  vscode.window.showTextDocument(
    await vscode.workspace.openTextDocument({ content, language: 'plaintext' }),
  );

export async function run(): Promise<void> {
  await vscode.extensions.getExtension('vscodevim.vim')!.activate();
  const mocha = new Mocha({ color: true, timeout: 5000 });

  for (const [key, selection] of [
    ['v', new vscode.Selection(0, 0, 0, 1)],
    ['V', new vscode.Selection(0, 0, 0, 3)],
  ] as const) {
    mocha.suite.addTest(
      new Mocha.Test(`Production bundle: ${key} enters visual mode`, async () => {
        const editor = await openEditor();
        await vscode.commands.executeCommand('type', { text: key });
        await waitFor(() => editor.selection.isEqual(selection));
        if (key === 'V') {
          await vscode.commands.executeCommand('type', { text: 'j' });
          await waitFor(() => editor.selection.isEqual(new vscode.Selection(0, 0, 1, 3)));
        }
        assert.strictEqual(editor.document.getText(), 'one\ntwo\nthree');
      }),
    );
  }

  mocha.suite.addTest(
    new Mocha.Test('Production bundle: visual block mode spans multiple lines', async () => {
      const editor = await openEditor();
      await vscode.commands.executeCommand('extension.vim_ctrl+v');
      await vscode.commands.executeCommand('type', { text: 'j' });
      await waitFor(
        () =>
          editor.selections.length === 2 &&
          editor.selections[0].isEqual(new vscode.Selection(0, 0, 0, 1)) &&
          editor.selections[1].isEqual(new vscode.Selection(1, 0, 1, 1)),
      );
    }),
  );

  mocha.suite.addTest(
    new Mocha.Test('Production bundle: visual mode works after multicursor IME input', async () => {
      const editor = await openEditor();
      await vscode.commands.executeCommand('type', { text: 'i' });
      await waitFor(() => editor.options.cursorStyle === vscode.TextEditorCursorStyle.Line);
      editor.selections = [new vscode.Selection(0, 0, 0, 0), new vscode.Selection(1, 0, 1, 0)];
      await vscode.commands.executeCommand('compositionStart');
      await vscode.commands.executeCommand('type', { text: 'nihao' });
      await vscode.commands.executeCommand('replacePreviousChar', {
        text: '你好',
        replaceCharCnt: 5,
      });
      await vscode.commands.executeCommand('compositionEnd');
      await vscode.commands.executeCommand('extension.vim_escape');
      await vscode.commands.executeCommand('type', { text: 'v' });
      await waitFor(
        () =>
          editor.selections.length === 2 &&
          editor.selections[0].isEqual(new vscode.Selection(0, 1, 0, 2)) &&
          editor.selections[1].isEqual(new vscode.Selection(1, 1, 1, 2)),
      );
      assert.strictEqual(editor.document.getText(), '你好one\n你好two\nthree');
    }),
  );

  mocha.suite.addTest(
    new Mocha.Test(
      'Production bundle: replaces preedit after the caret and commits emoji',
      async () => {
        const editor = await openEditor();
        await vscode.commands.executeCommand('type', { text: 'i' });
        await waitFor(() => editor.options.cursorStyle === vscode.TextEditorCursorStyle.Line);
        editor.selections = [new vscode.Selection(0, 0, 0, 0), new vscode.Selection(1, 0, 1, 0)];
        await vscode.commands.executeCommand('compositionStart');
        await vscode.commands.executeCommand('compositionType', {
          text: 'hh提示',
          replacePrevCharCnt: 0,
          replaceNextCharCnt: 0,
          positionDelta: -2,
        });
        await vscode.commands.executeCommand('compositionType', {
          text: '😀',
          replacePrevCharCnt: 2,
          replaceNextCharCnt: 2,
          positionDelta: 0,
        });
        await vscode.commands.executeCommand('compositionEnd');
        await vscode.commands.executeCommand('type', { text: '!' });
        await waitFor(() => editor.document.getText() === '😀!one\n😀!two\nthree');
      },
    ),
  );

  mocha.suite.addTest(
    new Mocha.Test(
      'Production bundle: cancelled preedit after the caret stays deleted',
      async () => {
        const editor = await openEditor();
        await vscode.commands.executeCommand('type', { text: 'i' });
        await vscode.commands.executeCommand('compositionStart');
        await vscode.commands.executeCommand('type', { text: '\u200b' });
        await vscode.commands.executeCommand('compositionType', {
          text: '',
          replacePrevCharCnt: 0,
          replaceNextCharCnt: 0,
          positionDelta: -1,
        });
        await vscode.commands.executeCommand('compositionType', {
          text: '',
          replacePrevCharCnt: 0,
          replaceNextCharCnt: 1,
          positionDelta: 0,
        });
        await vscode.commands.executeCommand('compositionEnd');
        await vscode.commands.executeCommand('type', { text: '!' });
        await waitFor(() => editor.document.getText() === '!one\ntwo\nthree');
      },
    ),
  );

  for (const reversed of [false, true]) {
    mocha.suite.addTest(
      new Mocha.Test(
        `Production bundle: multi-character typing replaces ${reversed ? 'backward' : 'forward'} selection`,
        async () => {
          const editor = await openEditor();
          await vscode.commands.executeCommand('type', { text: 'i' });
          await waitFor(() => editor.options.cursorStyle === vscode.TextEditorCursorStyle.Line);
          editor.selection = reversed
            ? new vscode.Selection(0, 3, 0, 0)
            : new vscode.Selection(0, 0, 0, 3);
          await vscode.commands.executeCommand('type', { text: '你好' });
          await vscode.commands.executeCommand('type', { text: '!' });
          await waitFor(() => editor.document.getText() === '你好!\ntwo\nthree');
          assert.ok(editor.selection.isEmpty);
        },
      ),
    );
  }

  mocha.suite.addTest(
    new Mocha.Test(
      'Production bundle: Chinese composition executes in the Ex command line',
      async () => {
        const editor = await openEditor();
        for (const text of ':s/one/') await vscode.commands.executeCommand('type', { text });
        await vscode.commands.executeCommand('compositionStart');
        await vscode.commands.executeCommand('type', { text: 'zhongwen' });
        await vscode.commands.executeCommand('compositionType', {
          text: '中文',
          replacePrevCharCnt: 8,
          replaceNextCharCnt: 0,
          positionDelta: -1,
        });
        await vscode.commands.executeCommand('compositionType', {
          text: '',
          replacePrevCharCnt: 0,
          replaceNextCharCnt: 0,
          positionDelta: 1,
        });
        await vscode.commands.executeCommand('compositionEnd');
        await vscode.commands.executeCommand('type', { text: '/' });
        await vscode.commands.executeCommand('vim.remap', { after: ['<Enter>'] });
        await waitFor(() => editor.document.getText() === '中文\ntwo\nthree');
      },
    ),
  );

  mocha.suite.addTest(
    new Mocha.Test(
      'Production bundle: exiting emoji insertion leaves a whole character for x',
      async () => {
        const editor = await openEditor();
        await vscode.commands.executeCommand('type', { text: 'i' });
        await vscode.commands.executeCommand('type', { text: '😀' });
        await waitFor(() => editor.document.getText() === '😀one\ntwo\nthree');
        await vscode.commands.executeCommand('extension.vim_escape');
        await vscode.commands.executeCommand('type', { text: 'x' });
        await waitFor(() => editor.document.getText() === 'one\ntwo\nthree');
      },
    ),
  );

  mocha.suite.addTest(
    new Mocha.Test(
      'Production bundle: Replace processes a multi-character Unicode payload',
      async () => {
        const editor = await openEditor();
        await vscode.commands.executeCommand('type', { text: 'R' });
        await vscode.commands.executeCommand('type', { text: '😀中' });
        await vscode.commands.executeCommand('type', { text: 'X' });
        await vscode.commands.executeCommand('extension.vim_escape');
        await waitFor(
          () =>
            editor.document.getText() === '😀中X\ntwo\nthree' &&
            editor.selection.active.character === 3,
        );
        assert.strictEqual(editor.selection.active.character, 3);
        await vscode.commands.executeCommand('type', { text: 'u' });
        await waitFor(() => editor.document.getText() === 'one\ntwo\nthree');
      },
    ),
  );

  mocha.suite.addTest(
    new Mocha.Test('Production bundle: counted r accepts a composed emoji', async () => {
      const editor = await openEditor();
      await vscode.commands.executeCommand('type', { text: '2' });
      await vscode.commands.executeCommand('type', { text: 'r' });
      await vscode.commands.executeCommand('compositionStart');
      await vscode.commands.executeCommand('type', { text: '😀' });
      await vscode.commands.executeCommand('compositionEnd');
      await waitFor(
        () =>
          editor.document.getText() === '😀😀e\ntwo\nthree' &&
          editor.selection.active.character === 2,
      );
      assert.strictEqual(editor.selection.active.character, 2);
    }),
  );

  mocha.suite.addTest(
    new Mocha.Test(
      'Production bundle: counted emoji insertion leaves the final emoji intact',
      async () => {
        const editor = await openEditor();
        await vscode.commands.executeCommand('type', { text: '2' });
        await vscode.commands.executeCommand('type', { text: 'i' });
        await vscode.commands.executeCommand('type', { text: '😀' });
        await vscode.commands.executeCommand('extension.vim_escape');
        await waitFor(
          () =>
            editor.document.getText() === '😀😀one\ntwo\nthree' &&
            editor.selection.active.character === 2,
        );
        assert.strictEqual(editor.selection.active.character, 2);
        await vscode.commands.executeCommand('type', { text: 'x' });
        await waitFor(() => editor.document.getText() === '😀one\ntwo\nthree');
      },
    ),
  );

  mocha.suite.addTest(
    new Mocha.Test(
      'Production bundle: Insert exits on the base of a decomposed accent',
      async () => {
        const editor = await openEditor('abcdef');
        await vscode.commands.executeCommand('type', { text: 'i' });
        await vscode.commands.executeCommand('type', { text: 'e\u0301' });
        await waitFor(() => editor.document.getText() === 'e\u0301abcdef');
        await vscode.commands.executeCommand('extension.vim_escape');
        await waitFor(() => editor.selection.active.character === 0);
        await vscode.commands.executeCommand('type', { text: 'x' });
        await waitFor(() => editor.document.getText() === 'abcdef');
      },
    ),
  );

  for (const [text, backspaces, expected] of [
    ['e\u0301', 1, '!abcdef'],
    ['👩\u200d💻', 2, '👩!abcdef'],
  ] as const) {
    mocha.suite.addTest(
      new Mocha.Test(
        `Production bundle: native Vim backspace for ${JSON.stringify(text)}`,
        async () => {
          const editor = await openEditor('abcdef');
          await vscode.commands.executeCommand('type', { text: 'i' });
          await vscode.commands.executeCommand('type', { text });
          for (let i = 0; i < backspaces; i++) {
            await vscode.commands.executeCommand('extension.vim_backspace');
          }
          await vscode.commands.executeCommand('type', { text: '!' });
          await waitFor(() => editor.document.getText() === expected);
        },
      ),
    );
  }

  mocha.suite.addTest(
    new Mocha.Test('Production bundle: counted R ends on the last ZWJ component', async () => {
      const editor = await openEditor('abcdef');
      await vscode.commands.executeCommand('type', { text: '2' });
      await vscode.commands.executeCommand('type', { text: 'R' });
      await vscode.commands.executeCommand('type', { text: '👩\u200d💻' });
      await vscode.commands.executeCommand('extension.vim_escape');
      await waitFor(
        () =>
          editor.document.getText() === '👩\u200d💻👩\u200d💻' &&
          editor.selection.active.character === 8,
      );
    }),
  );

  mocha.suite.addTest(
    new Mocha.Test(
      'Production bundle: one payload enters R before consuming composing marks',
      async () => {
        const editor = await openEditor('abcdef');
        await vscode.commands.executeCommand('type', { text: 'Re\u0301' });
        await vscode.commands.executeCommand('extension.vim_escape');
        await waitFor(
          () =>
            editor.document.getText() === 'e\u0301cdef' && editor.selection.active.character === 0,
        );
      },
    ),
  );

  mocha.suite.addTest(
    new Mocha.Test(
      'Production bundle: r composition keeps VS16 but consumes only the first component',
      async () => {
        const editor = await openEditor('abcdef');
        await vscode.commands.executeCommand('type', { text: '2' });
        await vscode.commands.executeCommand('type', { text: 'r' });
        await vscode.commands.executeCommand('compositionStart');
        await vscode.commands.executeCommand('type', { text: '🏳️\u200d🌈' });
        await vscode.commands.executeCommand('compositionEnd');
        await waitFor(
          () => editor.document.getText() === '🏳️🏳️cdef' && editor.selection.active.character === 3,
        );
      },
    ),
  );

  mocha.suite.addTest(
    new Mocha.Test('Production bundle: x counts complete composing characters', async () => {
      const editor = await openEditor('e\u0301a\u0308z');
      await vscode.commands.executeCommand('type', { text: '2' });
      await vscode.commands.executeCommand('type', { text: 'x' });
      await waitFor(
        () => editor.document.getText() === 'z' && editor.selection.active.character === 0,
      );
    }),
  );

  for (const [initial, expected, character] of [
    ['𝒯𝒰𝒯𝒰', '𝒰𝒯𝒯𝒰', 2],
    ['e\u0301a\u0308z', 'a\u0308e\u0301z', 2],
    ['😀ab', 'a😀b', 1],
    ['👩\u200d💻z', '\u200d👩💻z', 1],
  ] as const) {
    mocha.suite.addTest(
      new Mocha.Test(`Production bundle: xp preserves Vim boundaries in ${initial}`, async () => {
        const editor = await openEditor(initial);
        await vscode.commands.executeCommand('type', { text: 'xp' });
        await waitFor(
          () =>
            editor.document.getText() === expected &&
            editor.selection.active.character === character,
        );
      }),
    );
  }

  mocha.suite.addTest(
    new Mocha.Test(
      'Production bundle: visual put replaces the full composing character',
      async () => {
        const editor = await openEditor('Xe\u0301az');
        await vscode.commands.executeCommand('type', { text: 'xvp' });
        await waitFor(
          () => editor.document.getText() === 'Xaz' && editor.selection.active.character === 0,
        );
      },
    ),
  );

  mocha.suite.addTest(
    new Mocha.Test('Production bundle: configured digraphs override built-ins', async () => {
      const config = vscode.workspace.getConfiguration('vim');
      const previous = config.inspect('digraphs')?.globalValue;
      try {
        await config.update(
          'digraphs',
          { 'a*': ['a', 97], '*b': ['B', 66] },
          vscode.ConfigurationTarget.Global,
        );
        const editor = await openEditor('');
        await vscode.commands.executeCommand('type', { text: 'i' });
        for (const text of ['a*', '*a', 'b*', '*b']) {
          await vscode.commands.executeCommand('extension.vim_ctrl+k');
          for (const key of text) {
            await vscode.commands.executeCommand('type', { text: key });
          }
        }
        await waitFor(
          () => editor.document.getText() === 'aaβB' && editor.selection.active.character === 4,
        );
      } finally {
        await config.update('digraphs', previous, vscode.ConfigurationTarget.Global);
      }
    }),
  );

  mocha.suite.addTest(
    new Mocha.Test(
      'Production bundle: macro undo and redo preserve nested insertions',
      async () => {
        const editor = await openEditor('12');
        await vscode.commands.executeCommand('type', { text: 'qaiABC' });
        await vscode.commands.executeCommand('extension.vim_escape');
        await vscode.commands.executeCommand('type', { text: 'hhiXY' });
        await vscode.commands.executeCommand('extension.vim_escape');
        await vscode.commands.executeCommand('type', { text: 'q@au' });
        await vscode.commands.executeCommand('extension.vim_ctrl+r');
        await waitFor(
          () =>
            editor.document.getText() === 'XXYABCYABC12' && editor.selection.active.character === 1,
        );
      },
    ),
  );

  mocha.suite.addTest(
    new Mocha.Test(
      'Production bundle: Escape ends snippet navigation before normal editing',
      async () => {
        const editor = await openEditor('');
        await vscode.commands.executeCommand('type', { text: 'i' });
        await waitFor(() => editor.options.cursorStyle === vscode.TextEditorCursorStyle.Line);
        await editor.insertSnippet(
          new vscode.SnippetString('prefix ${1:first} ${2:second} suffix$0'),
        );
        await waitFor(() => editor.selection.isEqual(new vscode.Selection(0, 7, 0, 12)));
        await vscode.commands.executeCommand('type', { text: 'one' });
        await waitFor(() => editor.document.getText() === 'prefix one second suffix');
        await vscode.commands.executeCommand('extension.vim_escape');
        await waitFor(
          () =>
            editor.options.cursorStyle === vscode.TextEditorCursorStyle.Block &&
            editor.selection.active.character === 9,
        );
        await vscode.commands.executeCommand('jumpToNextSnippetPlaceholder');
        await vscode.commands.executeCommand('type', { text: 'hliX' });
        await vscode.commands.executeCommand('extension.vim_escape');
        await waitFor(
          () =>
            editor.document.getText() === 'prefix onXe second suffix' &&
            editor.selection.active.character === 9,
        );
      },
    ),
  );

  mocha.suite.addTest(
    new Mocha.Test('Production bundle: current-word search escapes punctuation once', async () => {
      const config = vscode.workspace.getConfiguration('vim');
      const previous = config.inspect('iskeyword')?.globalValue;
      try {
        const separators = (
          config.get<string>('iskeyword') ??
          vscode.workspace.getConfiguration('editor').get<string>('wordSeparators')!
        ).replace(/[.$]/g, '');
        await config.update('iskeyword', separators, vscode.ConfigurationTarget.Global);
        const editor = await openEditor('foo.bar fooXbar foo.bar foo.bar');
        await vscode.commands.executeCommand('type', { text: '*' });
        await waitFor(() => editor.selection.active.character === 16);
        await vscode.commands.executeCommand('type', { text: 'n' });
        await waitFor(() => editor.selection.active.character === 24);
        await vscode.commands.executeCommand('type', { text: 'N' });
        await waitFor(() => editor.selection.active.character === 16);
        assert.strictEqual(editor.document.getText(), 'foo.bar fooXbar foo.bar foo.bar');
      } finally {
        await config.update('iskeyword', previous, vscode.ConfigurationTarget.Global);
      }
    }),
  );

  const insertUndoFixture = async (): Promise<vscode.TextEditor> => {
    const editor = await openEditor('ab');
    for (const [text, expected] of [
      ['iX', 'Xab'],
      ['iY', 'YXab'],
    ]) {
      await vscode.commands.executeCommand('type', { text });
      await vscode.commands.executeCommand('extension.vim_escape');
      await waitFor(
        () =>
          editor.document.getText() === expected &&
          editor.options.cursorStyle === vscode.TextEditorCursorStyle.Block,
      );
    }
    return editor;
  };

  mocha.suite.addTest(
    new Mocha.Test('Production bundle: native undo aligns an entire Vim typing group', async () => {
      const editor = await insertUndoFixture();
      await vscode.commands.executeCommand('undo');
      await waitFor(() => editor.document.getText() === 'ab');
      await vscode.commands.executeCommand('type', { text: 'u' });
      await vscode.commands.executeCommand('extension.vim_ctrl+r');
      await waitFor(() => editor.document.getText() === 'Xab');
      await vscode.commands.executeCommand('extension.vim_ctrl+r');
      await waitFor(() => editor.document.getText() === 'YXab');
    }),
  );

  mocha.suite.addTest(
    new Mocha.Test(
      'Production bundle: native undo of Vim u preserves the original history',
      async () => {
        const editor = await insertUndoFixture();
        await vscode.commands.executeCommand('type', { text: 'u' });
        await waitFor(() => editor.document.getText() === 'Xab');
        await vscode.commands.executeCommand('undo');
        await waitFor(() => editor.document.getText() === 'YXab');
        await vscode.commands.executeCommand('type', { text: 'u' });
        await waitFor(() => editor.document.getText() === 'Xab');
        await vscode.commands.executeCommand('type', { text: 'u' });
        await waitFor(() => editor.document.getText() === 'ab');
      },
    ),
  );

  mocha.suite.addTest(
    new Mocha.Test('Production bundle: unmatched native undo preserves native redo', async () => {
      const editor = await openEditor('ab');
      await vscode.commands.executeCommand('type', { text: 'iX' });
      await waitFor(() => editor.document.getText() === 'Xab');
      assert.ok(await editor.edit((builder) => builder.insert(new vscode.Position(0, 1), 'Y')));
      await vscode.commands.executeCommand('extension.vim_escape');
      await waitFor(
        () =>
          editor.document.getText() === 'XYab' &&
          editor.options.cursorStyle === vscode.TextEditorCursorStyle.Block,
      );
      await vscode.commands.executeCommand('undo');
      await waitFor(() => editor.document.getText() === 'Xab');
      await vscode.commands.executeCommand('type', { text: 'u' });
      await vscode.commands.executeCommand('extension.vim_ctrl+r');
      await vscode.commands.executeCommand('redo');
      await waitFor(() => editor.document.getText() === 'XYab');
    }),
  );

  mocha.suite.addTest(
    new Mocha.Test(
      'Production bundle: dot cannot restore input cancelled by native undo',
      async () => {
        const editor = await openEditor('ab');
        await vscode.commands.executeCommand('type', { text: 'iX' });
        await vscode.commands.executeCommand('extension.vim_escape');
        await waitFor(
          () =>
            editor.document.getText() === 'Xab' &&
            editor.options.cursorStyle === vscode.TextEditorCursorStyle.Block,
        );
        await vscode.commands.executeCommand('type', { text: 'iY' });
        await waitFor(() => editor.document.getText() === 'YXab');
        await vscode.commands.executeCommand('extension.vim_ctrl+g');
        await vscode.commands.executeCommand('type', { text: 'u' });
        // A visible input after the undo-point command proves those queued Vim
        // commands completed before invoking the independent native undo command.
        await vscode.commands.executeCommand('type', { text: 'W' });
        await waitFor(() => editor.document.getText() === 'YWXab');
        await vscode.commands.executeCommand('undo');
        await waitFor(() => editor.document.getText() === 'ab');
        await vscode.commands.executeCommand('type', { text: 'Z' });
        await vscode.commands.executeCommand('extension.vim_escape');
        await waitFor(
          () =>
            editor.document.getText() === 'Zab' &&
            editor.options.cursorStyle === vscode.TextEditorCursorStyle.Block,
        );
        await vscode.commands.executeCommand('type', { text: '$.' });
        await waitFor(() => editor.document.getText() === 'ZaZb');
      },
    ),
  );

  mocha.suite.addTest(
    new Mocha.Test(
      'Production bundle: ordinary edits after native undo stay independently undoable',
      async () => {
        const editor = await openEditor('ab');
        assert.ok(await editor.edit((builder) => builder.insert(new vscode.Position(0, 0), 'X')));
        await vscode.commands.executeCommand('type', { text: '$' });
        await waitFor(() => editor.selection.active.character === 2);
        assert.ok(await editor.edit((builder) => builder.insert(new vscode.Position(0, 0), 'Y')));
        await vscode.commands.executeCommand('type', { text: '0' });
        await waitFor(() => editor.selection.active.character === 0);
        await vscode.commands.executeCommand('undo');
        await waitFor(() => editor.document.getText() === 'Xab');
        assert.ok(await editor.edit((builder) => builder.delete(new vscode.Range(0, 0, 0, 1))));
        await vscode.commands.executeCommand('type', { text: 'u' });
        await waitFor(() => editor.document.getText() === 'Xab');
        await vscode.commands.executeCommand('type', { text: 'u' });
        await waitFor(() => editor.document.getText() === 'ab');
      },
    ),
  );

  await new Promise<void>((resolve, reject) => {
    mocha.run((failures) => {
      if (failures > 0) reject(new Error(`${failures} production bundle tests failed`));
      else resolve();
    });
  });
}
