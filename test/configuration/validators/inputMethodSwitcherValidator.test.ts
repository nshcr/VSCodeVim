import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { InputMethodSwitcherConfigurationValidator } from '../../../src/configuration/validators/inputMethodSwitcherValidator';
import { Globals } from '../../../src/globals';
import { Configuration } from '../../testConfiguration';

suite('Input Method Switcher Validator', () => {
  let directory: string;
  let executable: string;
  let executableWithSpaces: string;
  let wasTesting: boolean;

  suiteSetup(() => {
    directory = fs.mkdtempSync(path.join(os.tmpdir(), 'vscodevim-ime-validator-'));
    executable = path.join(directory, 'im-select');
    executableWithSpaces = path.join(directory, 'input method switcher');
    fs.writeFileSync(executable, '', { mode: 0o755 });
    fs.writeFileSync(executableWithSpaces, '', { mode: 0o755 });
  });

  suiteTeardown(() => {
    fs.rmSync(directory, { recursive: true, force: true });
  });

  setup(() => {
    wasTesting = Globals.isTesting;
    Globals.isTesting = false;
  });

  teardown(() => {
    Globals.isTesting = wasTesting;
  });

  const configurationFor = (command: string): Configuration =>
    new Configuration({
      autoSwitchInputMethod: {
        enable: true,
        defaultIM: 'com.apple.keylayout.ABC',
        obtainIMCmd: command,
        switchIMCmd: `${command} {im}`,
      },
    });

  for (const [description, command] of [
    ['unquoted executable', () => executable],
    ['double-quoted executable', () => `"${executable}"`],
    ['single-quoted executable', () => `'${executable}'`],
    ['double-quoted executable containing spaces', () => `"${executableWithSpaces}"`],
    ['single-quoted executable containing spaces', () => `'${executableWithSpaces}'`],
    ['leading spaces and tab-separated arguments', () => ` \t${executable}\t--query`],
  ] as const) {
    test(`accepts an existing ${description}`, async () => {
      const configuration = configurationFor(command());
      const results = await new InputMethodSwitcherConfigurationValidator().validate(configuration);
      assert.deepStrictEqual(results.get(), []);
      assert.strictEqual(configuration.autoSwitchInputMethod.enable, true);
    });
  }

  test('rejects a missing quoted executable', async () => {
    const configuration = configurationFor(`"${path.join(directory, 'missing tool')}"`);
    const results = await new InputMethodSwitcherConfigurationValidator().validate(configuration);
    assert.strictEqual(results.numErrors, 2);
    assert.ok(results.get().every(({ message }) => message.startsWith('Unable to find')));
  });

  for (const command of ['', ' \t ', '"']) {
    test(`rejects an empty or malformed executable: ${JSON.stringify(command)}`, async () => {
      const configuration = configurationFor(command);
      const results = await new InputMethodSwitcherConfigurationValidator().validate(configuration);
      assert.strictEqual(results.numErrors, 2);
    });
  }
});
