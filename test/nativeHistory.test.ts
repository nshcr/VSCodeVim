import * as assert from 'assert';

import {
  findNativeHistoryIndex,
  NativeHistoryChange,
  NativeHistoryStep,
} from '../src/history/nativeHistory';

const change = (before: string, after: string, line = 0, character = 0): NativeHistoryChange => ({
  start: { line, character },
  before,
  after,
});

const step = (...changes: NativeHistoryChange[]): NativeHistoryStep => ({
  isFinished: true,
  changes,
});

suite('Native history boundary matching', () => {
  // ab -> Xab -> YXab. Native undo may reverse both Vim steps at once.
  const twoInsertions = [step(change('', 'X')), step(change('', 'Y'))];

  test('one native undo can align across multiple completed Vim steps', () => {
    assert.deepStrictEqual(findNativeHistoryIndex(twoInsertions, 1, 'YXab', 'ab'), {
      kind: 'matched',
      index: -1,
    });
  });

  test('one native redo can align across multiple completed Vim steps', () => {
    assert.deepStrictEqual(findNativeHistoryIndex(twoInsertions, -1, 'ab', 'YXab'), {
      kind: 'matched',
      index: 1,
    });
  });

  test('a native undo of Vim u can match a later history boundary', () => {
    assert.deepStrictEqual(findNativeHistoryIndex(twoInsertions, 0, 'Xab', 'YXab'), {
      kind: 'matched',
      index: 1,
    });
  });

  test('a native undo/redo net round trip keeps the current pointer', () => {
    assert.deepStrictEqual(findNativeHistoryIndex(twoInsertions, 1, 'YXab', 'YXab'), {
      kind: 'matched',
      index: 1,
    });
  });

  test('unchanged text is ambiguous when an earlier boundary has the same text', () => {
    const steps = [step(change('', 'X')), step(change('X', ''))];
    assert.deepStrictEqual(findNativeHistoryIndex(steps, 1, 'ab', 'ab'), {
      kind: 'ambiguous',
    });
  });

  test('unchanged text is ambiguous when a later boundary has the same text', () => {
    const steps = [...twoInsertions, step(change('Y', ''))];
    assert.deepStrictEqual(findNativeHistoryIndex(steps, 0, 'Xab', 'Xab'), {
      kind: 'ambiguous',
    });
  });

  test('unchanged text still requires a complete search within the budget', () => {
    assert.deepStrictEqual(
      findNativeHistoryIndex(twoInsertions, 1, 'YXab', 'YXab', { maxSteps: 1 }),
      { kind: 'incomplete' },
    );
  });

  test('unchanged text with an empty history matches the initial boundary', () => {
    assert.deepStrictEqual(findNativeHistoryIndex([], -1, 'ab', 'ab'), {
      kind: 'matched',
      index: -1,
    });
  });

  test('nested edits are reversed in execution order against intermediate text', () => {
    const steps = [step(change('', 'ABC'), change('', 'XY', 0, 1))];
    assert.deepStrictEqual(findNativeHistoryIndex(steps, 0, 'AXYBCab', 'ab'), {
      kind: 'matched',
      index: -1,
    });
    assert.deepStrictEqual(findNativeHistoryIndex(steps, -1, 'ab', 'AXYBCab'), {
      kind: 'matched',
      index: 0,
    });
  });

  for (const newline of ['\n', '\r\n']) {
    test(`multiline UTF-16 positions remain exact with ${JSON.stringify(newline)}`, () => {
      const first = `👩\u200d💻e\u0301${newline}`;
      const initial = `ab${newline}cd`;
      const final = `${first}🧪ab${newline}cd`;
      const steps = [step(change('', first)), step(change('', '🧪', 1))];
      assert.deepStrictEqual(findNativeHistoryIndex(steps, 1, final, initial), {
        kind: 'matched',
        index: -1,
      });
      assert.deepStrictEqual(findNativeHistoryIndex(steps, -1, initial, final), {
        kind: 'matched',
        index: 1,
      });
    });
  }

  test('positions after a surrogate pair count UTF-16 code units', () => {
    const steps = [step(change('', 'X', 0, 2))];
    assert.deepStrictEqual(findNativeHistoryIndex(steps, 0, '😀Xab', '😀ab'), {
      kind: 'matched',
      index: -1,
    });
  });

  test('identical target text at two earlier boundaries is ambiguous', () => {
    // ab -> Xab -> ab -> Yab; native target ab has two possible past indices.
    const steps = [step(change('', 'X')), step(change('X', '')), step(change('', 'Y'))];
    assert.deepStrictEqual(findNativeHistoryIndex(steps, 2, 'Yab', 'ab'), {
      kind: 'ambiguous',
    });
  });

  test('identical target text in past and future is ambiguous', () => {
    // ab -> Xab -> YXab -> Xab, currently at YXab.
    const steps = [...twoInsertions, step(change('Y', ''))];
    assert.deepStrictEqual(findNativeHistoryIndex(steps, 1, 'YXab', 'Xab'), {
      kind: 'ambiguous',
    });
  });

  test('a cancelling step cannot conceal another matching boundary', () => {
    const steps = [step(change('', 'X')), step(change('', 'Y'), change('Y', ''))];
    assert.deepStrictEqual(findNativeHistoryIndex(steps, -1, 'ab', 'Xab'), {
      kind: 'ambiguous',
    });
  });

  test('an intermediate native state inside a Vim step is unmatched', () => {
    const steps = [step(change('', 'ABC'))];
    assert.deepStrictEqual(findNativeHistoryIndex(steps, 0, 'ABCab', 'ABab'), {
      kind: 'unmatched',
    });
  });

  test('a target outside every history boundary is unmatched', () => {
    assert.deepStrictEqual(findNativeHistoryIndex(twoInsertions, 1, 'YXab', 'Qab'), {
      kind: 'unmatched',
    });
  });

  for (const invalid of [
    change('', 'X', 1),
    change('', 'X', 0, 3),
    change('', 'X', -1),
    change('', 'X', 0, -1),
    change('', 'X', 0, 0.5),
  ]) {
    test(`invalid start ${JSON.stringify(invalid.start)} is not clamped`, () => {
      assert.deepStrictEqual(findNativeHistoryIndex([step(invalid)], -1, 'ab', 'Xab'), {
        kind: 'invalid',
      });
    });
  }

  test('an expected-before mismatch is invalid even if slicing could produce a target', () => {
    assert.deepStrictEqual(findNativeHistoryIndex([step(change('Z', 'X'))], -1, 'ab', 'Xb'), {
      kind: 'invalid',
    });
  });

  test('a replacement extending beyond the document is invalid', () => {
    assert.deepStrictEqual(findNativeHistoryIndex([step(change('abc', 'X'))], -1, 'ab', 'X'), {
      kind: 'invalid',
    });
  });

  test('a range ending inside CRLF is invalid', () => {
    assert.deepStrictEqual(
      findNativeHistoryIndex([step(change('\r', '', 0, 2))], -1, 'ab\r\ncd', 'ab\ncd'),
      { kind: 'invalid' },
    );
  });

  test('a replacement whose end is inside resulting CRLF is invalid', () => {
    assert.deepStrictEqual(
      findNativeHistoryIndex([step(change('', '\r', 0, 2))], -1, 'ab\ncd', 'ab\r\ncd'),
      { kind: 'invalid' },
    );
  });

  test('an unfinished step cannot be used as a native history boundary', () => {
    const unfinished = { ...step(change('', 'X')), isFinished: false };
    assert.deepStrictEqual(findNativeHistoryIndex([unfinished], -1, 'ab', 'Xab'), {
      kind: 'invalid',
    });
    assert.deepStrictEqual(findNativeHistoryIndex([unfinished], 0, 'Xab', 'ab'), {
      kind: 'invalid',
    });
    assert.deepStrictEqual(findNativeHistoryIndex([unfinished], 0, 'Xab', 'Xab'), {
      kind: 'invalid',
    });
  });

  test('a found candidate is not accepted when the step budget truncates the remaining search', () => {
    assert.deepStrictEqual(
      findNativeHistoryIndex(twoInsertions, 1, 'YXab', 'Xab', { maxSteps: 1 }),
      { kind: 'incomplete' },
    );
  });

  test('a text-processing budget prevents replaying even a single large replacement', () => {
    const large = 'a'.repeat(1000);
    assert.deepStrictEqual(
      findNativeHistoryIndex([step(change('', large))], 0, `${large}ab`, 'ab', {
        maxTextLength: 16,
      }),
      { kind: 'incomplete' },
    );
  });

  test('matching leaves caller history and changes untouched', () => {
    const insertion = Object.freeze(change('', 'X'));
    Object.freeze(insertion.start);
    const changes = Object.freeze([insertion]);
    const steps = Object.freeze([Object.freeze({ isFinished: true, changes })]);
    const before = JSON.stringify(steps);
    assert.deepStrictEqual(findNativeHistoryIndex(steps, 0, 'Xab', 'ab'), {
      kind: 'matched',
      index: -1,
    });
    assert.strictEqual(JSON.stringify(steps), before);
  });

  test('all unique boundaries in a mixed-text insertion history align in either direction', () => {
    const fragments = ['a', '😀', '\n', 'e\u0301', '👩\u200d💻', 'z'];
    const states = [''];
    const steps: NativeHistoryStep[] = [];
    let text = '';
    for (const fragment of fragments) {
      const lines = text.split('\n');
      steps.push(step(change('', fragment, lines.length - 1, lines[lines.length - 1].length)));
      text += fragment;
      states.push(text);
    }

    for (let from = 0; from < states.length; from++) {
      for (let to = 0; to < states.length; to++) {
        assert.deepStrictEqual(
          findNativeHistoryIndex(steps, from - 1, states[from], states[to]),
          { kind: 'matched', index: to - 1 },
          `from ${from - 1} to ${to - 1}`,
        );
      }
    }
  });

  test('seeded mixed histories agree with all independently recorded text boundaries', () => {
    let seed = 0x5eed1007;
    const choose = (length: number): number => {
      seed = (seed * 1664525 + 1013904223) % 0x100000000;
      return seed % length;
    };
    const values = ['ab', 'Xab', 'YXab', '😀', 'e\u0301', 'a\nb', 'a\r\nb'];

    for (let scenario = 0; scenario < 80; scenario++) {
      const states = [values[choose(values.length)]];
      const steps: NativeHistoryStep[] = [];
      const count = 3 + choose(5);
      for (let index = 0; index < count; index++) {
        const before = states[states.length - 1];
        const after = values[choose(values.length)];
        steps.push(step(change(before, after)));
        states.push(after);
      }

      // The oracle is the state sequence retained while constructing the
      // history. It does not replay changes or share the matcher's range logic.
      for (let from = 0; from < states.length; from++) {
        for (const target of states) {
          const matches = states.flatMap((text, index) => (text === target ? [index - 1] : []));
          const expected =
            matches.length === 1 ? { kind: 'matched', index: matches[0] } : { kind: 'ambiguous' };
          assert.deepStrictEqual(
            findNativeHistoryIndex(steps, from - 1, states[from], target),
            expected,
            JSON.stringify({ scenario, from: from - 1, target, states }),
          );
        }
      }
    }
  });
});
