// 逻辑终端模型
// -----------------------------------------------------------------------------
// Terminal 不直接操作 DOM，也不直接画 Canvas。它只维护一块“字符屏幕”：
// - 每个格子里存一个字符。
// - 每个格子额外存一组属性，例如光标、反色、闪烁。
// - 当前屏幕之外保留几页滚动历史。
//
// fancy.js 会把这里的字符缓冲转换成 WebGL 顶点缓冲，再交给 shader 绘制。

class Terminal {
  constructor() {
    this.width = 60;
    this.height = 24;
    this.page = this.width * this.height;
    this.cursor = { x: 0, y: 0, visible: true };

    // 保存 5 页内容：前 4 页作为滚动历史，最后 1 页是当前输入页。
    this.buffer = new Array(this.page * 5);
    this.attrs = new Array(this.buffer.length);
    this.offset = this.page * 4;

    for (let cellIndex = 0; cellIndex < this.buffer.length; cellIndex++) {
      this.buffer[cellIndex] = " ";
      this.attrs[cellIndex] = 0;
    }

    // WebGL 每个字符用两个三角形绘制。这里的 6 表示两个三角形的 6 个顶点。
    this._charBuffer = new Float32Array(this.buffer.length * 6);
    this._geoBuffer = new Float32Array(this.buffer.length * 6);
    this.clear();
  }

  clear() {
    this.end();
    this.cursor.x = 0;
    this.cursor.y = 0;

    for (let cellIndex = 0; cellIndex < this.page; cellIndex++) {
      const bufferIndex = cellIndex + this.offset;
      this.buffer[bufferIndex] = " ";
      this.attrs[bufferIndex] = 0;
    }

    this._dirty = true;
  }

  fill(char) {
    this.clear();

    for (let cellIndex = 0; cellIndex < this.page - 1; cellIndex++) {
      this.addChar(char);
    }
  }

  addString(text, wrap, attrs = 0) {
    this.end();

    if (!text.length) return;

    let output = text;

    if (wrap) {
      // 按终端宽度自动换行。这个实现适合 ASCII 演示文本；中文字符在位图字体中
      // 通常没有对应字形，因此终端内的演示输出保持英文。
      const maxWidth = this.width - 2;
      const wrapped = output.match(RegExp(`.{1,${maxWidth}}(\\s|$)`, "g"));
      output = wrapped ? wrapped.join("\n") : output;
    }

    for (let charIndex = 0; charIndex < output.length; charIndex++) {
      this.addChar(output.charAt(charIndex), attrs);
    }
  }

  addChar(char, attrs) {
    this.end();

    const cellIndex = this.cursor.y * this.width + this.cursor.x;
    const bufferIndex = cellIndex + this.offset;

    if (char !== "\n") {
      this.buffer[bufferIndex] = char;
      this.attrs[bufferIndex] = attrs || 0;
    }

    if (char === "\n" || this.cursor.x >= this.width - 1) {
      this.cursor.x = 0;
      this.cursor.y++;
    } else {
      this.cursor.x++;
    }

    if (this.cursor.y >= this.height) {
      this.scrollOneLine();
    }

    this._dirty = true;
  }

  scrollOneLine() {
    this.cursor.y--;

    const lastLineStart = this.buffer.length - this.width;

    for (let cellIndex = 0; cellIndex < this.buffer.length; cellIndex++) {
      if (cellIndex < lastLineStart) {
        this.buffer[cellIndex] = this.buffer[cellIndex + this.width];
        this.attrs[cellIndex] = this.attrs[cellIndex + this.width];
      } else {
        this.buffer[cellIndex] = " ";
        this.attrs[cellIndex] = 0;
      }
    }
  }

  pageUp() {
    this.offset = Math.max(0, this.offset - this.page);
    this.cursor.visible = false;
    this._dirty = true;
  }

  pageDown() {
    this.offset = Math.min(
      this.buffer.length - this.page,
      this.offset + this.page,
    );
    this.cursor.visible = this.offset === this.buffer.length - this.page;
    this._dirty = true;
  }

  end() {
    this.offset = this.buffer.length - this.page;
    this.cursor.visible = true;
    this._dirty = true;
  }

  backspace() {
    if (this.cursor.x <= 0) return;

    const cellIndex = this.cursor.y * this.width + this.cursor.x - 1;
    const bufferIndex = cellIndex + this.offset;

    // 提示符在行首，退格时不要把它删掉。
    if (this.cursor.x === 1 && this.buffer[bufferIndex] === ">") return;

    this.buffer[bufferIndex] = " ";
    this.attrs[bufferIndex] = 0;
    this.cursor.x--;
    this._dirty = true;
  }

  clearToStartOfLine() {
    while (this.cursor.x > 0) {
      const cellIndex = this.cursor.y * this.width + this.cursor.x;
      const bufferIndex = cellIndex + this.offset;
      this.buffer[bufferIndex] = " ";
      this.attrs[bufferIndex] = 0;
      this.cursor.x--;
    }

    this._dirty = true;
  }

  _update() {
    if (!this._dirty) return;

    for (let cellIndex = 0; cellIndex < this.page; cellIndex++) {
      const vertexIndex = cellIndex * 6;
      const bufferIndex = cellIndex + this.offset;
      const charCode = this.buffer[bufferIndex].charCodeAt(0);
      const cursorY = Math.floor(cellIndex / this.width);
      const cursorX = cellIndex - cursorY * this.width;
      let attrs = this.attrs[bufferIndex];

      if (
        this.cursor.visible &&
        this.cursor.x === cursorX &&
        this.cursor.y === cursorY
      ) {
        attrs |= Terminal.ATTR_CURSOR;
      }

      // charBuffer：告诉 shader “这个格子是什么字符、有什么属性”。
      this._charBuffer[vertexIndex + 0] = charCode;
      this._charBuffer[vertexIndex + 1] = attrs;
      this._charBuffer[vertexIndex + 2] = charCode;
      this._charBuffer[vertexIndex + 3] = attrs;
      this._charBuffer[vertexIndex + 4] = charCode;
      this._charBuffer[vertexIndex + 5] = attrs;

      // geoBuffer：告诉 shader “这个字符格子在终端网格中的位置”。
      this._geoBuffer[vertexIndex + 0] = cellIndex;
      this._geoBuffer[vertexIndex + 1] = 0;
      this._geoBuffer[vertexIndex + 2] = cellIndex;
      this._geoBuffer[vertexIndex + 3] = 1;
      this._geoBuffer[vertexIndex + 4] = cellIndex;
      this._geoBuffer[vertexIndex + 5] = 2;
    }

    this._dirty = false;
  }

  getCharBuffer() {
    this._update();
    return this._charBuffer;
  }

  getGeoBuffer() {
    this._update();
    return this._geoBuffer;
  }

  toString() {
    const lines = [];

    for (let rowIndex = 0; rowIndex < this.height; rowIndex++) {
      const lineStart = this.offset + rowIndex * this.width;
      const lineEnd = lineStart + this.width;
      lines.push(this.buffer.slice(lineStart, lineEnd).join(""));
    }

    return lines.join("\n");
  }
}

// 字符属性是位标记：一个字符可以同时拥有多个效果。
Terminal.ATTR_CURSOR = 1;
Terminal.ATTR_INVERSE = 2;
Terminal.ATTR_BLINK = 4;
