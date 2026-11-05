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
        await waitFor(() => editor.document.getText() === '😀中X\ntwo\nthree');
        await waitFor(() => editor.options.cursorStyle === vscode.TextEditorCursorStyle.Block);
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

  await new Promise<void>((resolve, reject) => {
    mocha.run((failures) => {
      if (failures > 0) reject(new Error(`${failures} production bundle tests failed`));
      else resolve();
    });
  });
}
