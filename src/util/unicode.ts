// Vim attaches nonspacing/enclosing marks to the preceding character. ZWJ,
// spacing marks and emoji modifiers remain separate editing characters.
const combiningCharacter = /^[\p{Mn}\p{Me}]$/u;

export function isCombiningCharacter(character: string): boolean {
  return combiningCharacter.test(character);
}

function previousCodePointIndex(text: string, offset: number): number {
  const previous = Math.max(0, offset - 1);
  return previous > 0 && (text.codePointAt(previous - 1) ?? 0) > 0xffff ? previous - 1 : previous;
}

/** The UTF-16 boundary after one Vim editing character. */
export function nextVimCharacterIndex(text: string, offset: number): number {
  let next = Math.max(0, Math.min(offset, text.length));
  if (next === text.length) {
    return next;
  }
  next += (text.codePointAt(next) ?? 0) > 0xffff ? 2 : 1;
  while (next < text.length) {
    const character = String.fromCodePoint(text.codePointAt(next)!);
    if (!isCombiningCharacter(character)) {
      break;
    }
    next += character.length;
  }
  return next;
}

/** The UTF-16 boundary before one Vim editing character. */
export function previousVimCharacterIndex(text: string, offset: number): number {
  let previous = previousCodePointIndex(text, Math.max(0, Math.min(offset, text.length)));
  while (previous > 0 && isCombiningCharacter(String.fromCodePoint(text.codePointAt(previous)!))) {
    previous = previousCodePointIndex(text, previous);
  }
  return previous;
}

export function splitVimCharacters(text: string): string[] {
  const characters: string[] = [];
  for (let start = 0; start < text.length;) {
    const end = nextVimCharacterIndex(text, start);
    characters.push(text.slice(start, end));
    start = end;
  }
  return characters;
}
