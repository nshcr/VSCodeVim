export class CompositionState {
  isInComposition: boolean = false;
  insertedText: boolean = false;
  composingText: string = '';
  /** UTF-16 offset of the IME caret within the preedit text. */
  composingTextPosition: number = 0;

  update(text: string, replacePrevCharCnt = 0, replaceNextCharCnt = 0, positionDelta = 0) {
    const start = Math.max(0, this.composingTextPosition - replacePrevCharCnt);
    const end = this.composingTextPosition + replaceNextCharCnt;
    this.composingText = this.composingText.slice(0, start) + text + this.composingText.slice(end);
    this.composingTextPosition = Math.max(
      0,
      Math.min(this.composingText.length, start + text.length + positionDelta),
    );
  }

  reset() {
    this.isInComposition = false;
    this.insertedText = false;
    this.composingText = '';
    this.composingTextPosition = 0;
  }
}
