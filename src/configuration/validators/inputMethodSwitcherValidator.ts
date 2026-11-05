import { existsAsync } from 'platform/fs';
import { Globals } from '../../globals';
import { configurationValidator } from '../configurationValidator';
import { IConfiguration } from '../iconfiguration';
import { IConfigurationValidator, ValidatorResults } from '../iconfigurationValidator';

export class InputMethodSwitcherConfigurationValidator implements IConfigurationValidator {
  async validate(config: IConfiguration): Promise<ValidatorResults> {
    const result = new ValidatorResults();

    const inputMethodConfig = config.autoSwitchInputMethod;

    if (!inputMethodConfig.enable || Globals.isTesting) {
      return Promise.resolve(result);
    }

    const obtainCommand = this.getRawCmd(inputMethodConfig.obtainIMCmd ?? '');
    const switchCommand = this.getRawCmd(inputMethodConfig.switchIMCmd);

    if (!inputMethodConfig.switchIMCmd.includes('{im}')) {
      result.append({
        level: 'error',
        message:
          'vim.autoSwitchInputMethod.switchIMCmd is incorrect, it should contain the placeholder {im}.',
      });
    }

    if (
      inputMethodConfig.obtainIMCmd === undefined ||
      inputMethodConfig.obtainIMCmd.trim() === ''
    ) {
      result.append({
        level: 'error',
        message: 'vim.autoSwitchInputMethod.obtainIMCmd is empty.',
      });
    } else if (!obtainCommand || !(await existsAsync(obtainCommand))) {
      result.append({
        level: 'error',
        message: `Unable to find ${inputMethodConfig.obtainIMCmd}. Check your 'vim.autoSwitchInputMethod.obtainIMCmd' in VSCode setting.`,
      });
    }

    if (inputMethodConfig.defaultIM === undefined || inputMethodConfig.defaultIM === '') {
      result.append({
        level: 'error',
        message: 'vim.autoSwitchInputMethod.defaultIM is empty.',
      });
    } else if (!switchCommand || !(await existsAsync(switchCommand))) {
      result.append({
        level: 'error',
        message: `Unable to find ${inputMethodConfig.switchIMCmd}. Check your 'vim.autoSwitchInputMethod.switchIMCmd' in VSCode setting.`,
      });
    }

    return Promise.resolve(result);
  }

  disable(config: IConfiguration) {
    config.autoSwitchInputMethod.enable = false;
  }

  private getRawCmd(cmd: string): string {
    // The command is run by a shell, so a quoted executable may contain spaces.
    const executable = /^\s*(?:"([^"]+)"|'([^']+)'|([^\s"']+))(?=\s|$)/.exec(cmd);
    return executable?.[1] ?? executable?.[2] ?? executable?.[3] ?? '';
  }
}

configurationValidator.registerValidator(new InputMethodSwitcherConfigurationValidator());
