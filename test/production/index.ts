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

const openEditor = async (): Promise<vscode.TextEditor> =>
  vscode.window.showTextDocument(
    await vscode.workspace.openTextDocument({ content: 'one\ntwo\nthree', language: 'plaintext' }),
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

  await new Promise<void>((resolve, reject) => {
    mocha.run((failures) => {
      if (failures > 0) reject(new Error(`${failures} production bundle tests failed`));
      else resolve();
    });
  });
}
