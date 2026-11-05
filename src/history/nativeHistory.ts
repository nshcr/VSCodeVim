export interface NativeHistoryChange {
  readonly start: { readonly line: number; readonly character: number };
  readonly before: string;
  readonly after: string;
}

export interface NativeHistoryStep {
  readonly isFinished: boolean;
  readonly changes: readonly NativeHistoryChange[];
}

type Alignment =
  | { kind: 'matched'; index: number }
  | { kind: 'unmatched' | 'ambiguous' | 'incomplete' | 'invalid' };

/** Unlike TextDocument.offsetAt, this rejects positions instead of clamping. */
function offsetAt(text: string, position: NativeHistoryChange['start']): number | undefined {
  const { line, character } = position;
  if (!Number.isInteger(line) || !Number.isInteger(character) || line < 0 || character < 0) {
    return undefined;
  }
  let start = 0;
  for (let index = 0; index < line; index++) {
    const nextLineBreak = text.indexOf('\n', start);
    if (nextLineBreak === -1) {
      return undefined;
    }
    start = nextLineBreak + 1;
  }
  const newline = text.indexOf('\n', start);
  const end = newline === -1 ? text.length : newline;
  const length = end - start - (newline !== -1 && text[end - 1] === '\r' ? 1 : 0);
  return character <= length ? start + character : undefined;
}

function endPosition(
  start: NativeHistoryChange['start'],
  text: string,
): NativeHistoryChange['start'] {
  const lines = text.split('\n');
  return lines.length === 1
    ? { line: start.line, character: start.character + text.length }
    : { line: start.line + lines.length - 1, character: lines[lines.length - 1].length };
}

/**
 * Match the actual native result against every reachable, completed Vim step.
 * Native Undo may reverse a programmatic Vim undo, so both directions matter.
 * A partial scan cannot prove uniqueness and must never move the live pointer.
 */
export function findNativeHistoryIndex(
  steps: readonly NativeHistoryStep[],
  currentIndex: number,
  fromText: string,
  targetText: string,
  limits: { maxSteps?: number; maxTextLength?: number } = {},
): Alignment {
  if (!Number.isInteger(currentIndex) || currentIndex < -1 || currentIndex >= steps.length) {
    return { kind: 'invalid' };
  }
  const maxSteps = limits.maxSteps ?? 2048;
  const maxTextLength = limits.maxTextLength ?? 16 * 1024 * 1024;
  let stepCount = 0;
  let textLength = 0;
  let match: number | undefined = fromText === targetText ? currentIndex : undefined;

  for (const direction of [-1, 1]) {
    let text = fromText;
    let index = currentIndex;
    while (direction === -1 ? index >= 0 : index + 1 < steps.length) {
      if (++stepCount > maxSteps) {
        return { kind: 'incomplete' };
      }
      const step = steps[direction === -1 ? index : index + 1];
      if (!step.isFinished) {
        return { kind: 'invalid' };
      }
      const changes = direction === -1 ? [...step.changes].reverse() : step.changes;
      for (const change of changes) {
        const before = direction === -1 ? change.after : change.before;
        const after = direction === -1 ? change.before : change.after;
        textLength += Math.max(text.length, text.length - before.length + after.length);
        if (textLength > maxTextLength) {
          return { kind: 'incomplete' };
        }
        const start = offsetAt(text, change.start);
        if (
          start === undefined ||
          offsetAt(text, endPosition(change.start, before)) !== start + before.length ||
          text.slice(start, start + before.length) !== before
        ) {
          return { kind: 'invalid' };
        }
        text = text.slice(0, start) + after + text.slice(start + before.length);
        if (offsetAt(text, endPosition(change.start, after)) !== start + after.length) {
          return { kind: 'invalid' };
        }
      }
      index += direction;
      textLength += text.length;
      if (textLength > maxTextLength) {
        return { kind: 'incomplete' };
      }
      if (text === targetText) {
        if (match !== undefined) {
          return { kind: 'ambiguous' };
        }
        match = index;
      }
    }
  }
  return match === undefined ? { kind: 'unmatched' } : { kind: 'matched', index: match };
}
