// WebGL 复古 CRT 终端视图
// -----------------------------------------------------------------------------
// 这个文件是 fancy-term 的核心。它从 langterm 的 fancy 模式提取而来，只保留
// “用 WebGL 把终端字符画成老式 CRT 屏幕”的部分。
//
// 数据流可以理解为：
// 用户按键 -> inputBuffer -> Terminal 字符网格 -> WebGL Buffer -> Shader -> Canvas
//
// 渲染管线分为三步：
// 1. Terminal Pass：把字符网格画到 termTex 纹理。
// 2. Post Pass：对 termTex 做 CRT 扫描线和屏幕弯曲后处理，得到 postTex。
// 3. Composite Pass：先画背景图，再把 postTex 合成到背景屏幕上。

const fancyView = (() => {
  const HISTORY_KEY = "fancy-term-history";
  const FRAMEBUFFER_SIZE = 2048;

  let assets,
    canvas,
    gl,
    terminal,
    inputBuffer = "",
    historyIndex = 0,
    animationFrameId = null,
    inputLocked = false,
    activeStream = null;

  const history = (() => {
    try {
      return JSON.parse(sessionStorage.getItem(HISTORY_KEY)) || [];
    } catch (error) {
      return [];
    }
  })();

  // WebGL 对象较多，按“用途 + 类型”的方式命名，方便和 render() 的三个阶段对应。
  let bgImageTex,
    bgImageTexLocation,
    bgPositionBuffer,
    bgPositionLocation,
    bgProgram,
    bgScreenSizeLocation,
    bgSizeLocation,
    bgTexCoordBuffer,
    bgTexCoordLocation,
    bgTimeLocation,
    compBGSizeLocation,
    compPositionBuffer,
    compPositionLocation,
    compPostTexLocation,
    compProgram,
    compScreenSizeLocation,
    compTexCoordBuffer,
    compTexCoordLocation,
    compDegaussTimeLocation,
    postFrameBuf,
    postPositionBuffer,
    postPositionLocation,
    postProgram,
    postTermTexLocation,
    postTex,
    postTexCoordBuffer,
    postTexCoordLocation,
    termCharBuffer,
    termCharLocation,
    termFontTex,
    termFontTexLocation,
    termFrameBuf,
    termGeoBuffer,
    termGeoLocation,
    termGridSizeLocation,
    termProgram,
    termScreenSizeLocation,
    termTex,
    termTimeLocation;

  const parameters = {
    startTime: Date.now(),
    time: 0,
    startDegaussTime: Date.now(),
    degaussTime: 0,
    screenWidth: 0,
    screenHeight: 0,
    gridWidth: 0,
    gridHeight: 0,
  };

  const saveHistory = () => {
    sessionStorage.setItem(HISTORY_KEY, JSON.stringify(history));
  };

  const pushHistory = (message) => {
    if (!/\S/.test(message)) return;

    history.push(message);

    if (history.length > 50) {
      history.shift();
    }

    saveHistory();
  };

  // 把终端模型里的字符数据上传到 GPU。只有字符变化时才需要调用它。
  const updateBuffers = () => {
    if (!gl || !termGeoBuffer || !termCharBuffer) return;

    gl.bindBuffer(gl.ARRAY_BUFFER, termGeoBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, terminal.getGeoBuffer(), gl.STATIC_DRAW);

    gl.bindBuffer(gl.ARRAY_BUFFER, termCharBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, terminal.getCharBuffer(), gl.STATIC_DRAW);
  };

  const promptText = () => terminal.promptText || ">";

  const redrawInputLine = () => {
    terminal.end();
    terminal.clearToStartOfLine();
    terminal.addString(promptText(), false);
    terminal.addString(inputBuffer, false);
    updateBuffers();
  };

  // 输出文本时会识别开头的全大写标题，并用反色属性显示。
  const renderOutput = (output) => {
    terminal.end();
    terminal.clearToStartOfLine();

    const normalizedOutput = String(output || "");
    const headingPattern = /^([A-Z ]+)(\n+)/s;
    const headingMatch = normalizedOutput.match(headingPattern);

    if (headingMatch) {
      terminal.addString(headingMatch[1], true, Terminal.ATTR_INVERSE);
      terminal.addChar("\n");
    }

    terminal.addString(normalizedOutput.replace(headingPattern, ""), true);
    terminal.addString(inputBuffer, false);
    updateBuffers();
  };

  const renderCommandResult = (result) => {
    if (result && result.clear) {
      terminal.clear();
    }

    if (result && result.prompt) {
      terminal.promptText = result.prompt;
    }

    renderOutput(result && result.output ? result.output : promptText());
  };

  // 仅保留 ASCII 可打印字符 + 制表/换行/回车，避免位图字体出现缺字符。
  const sanitizeAscii = (text) =>
    String(text || "").replace(/[^\x09\x0A\x0D\x20-\x7E]/g, "");

  // 流式调用 /api/chat：在终端内逐字渲染回复，同时锁定输入。
  const streamChat = async (messages) => {
    inputLocked = true;
    const controller = new AbortController();
    activeStream = controller;

    terminal.end();
    terminal.clearToStartOfLine();
    updateBuffers();

    let assistantText = "";
    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages }),
        signal: controller.signal,
      });
      if (!response.ok || !response.body) {
        const detail = await response.text().catch(() => "");
        throw new Error(
          `HTTP ${response.status}${detail ? ": " + detail.slice(0, 120) : ""}`,
        );
      }
      const reader = response.body.getReader();
      const decoder = new TextDecoder("utf-8");
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        const chunk = sanitizeAscii(decoder.decode(value, { stream: true }));
        if (!chunk) continue;
        assistantText += chunk;
        terminal.addString(chunk, true);
        updateBuffers();
      }
      const tail = sanitizeAscii(decoder.decode());
      if (tail) {
        assistantText += tail;
        terminal.addString(tail, true);
      }
    } catch (error) {
      const message =
        error && error.name === "AbortError"
          ? "[aborted]"
          : `[error: ${(error && error.message) || "chat failed"}]`;
      terminal.addString("\n" + message, true);
    } finally {
      activeStream = null;
      if (assistantText.trim()) {
        demoCommands.pushAssistantMessage(assistantText);
      }
      terminal.addString("\n\n" + promptText(), false);
      terminal.addString(inputBuffer, false);
      updateBuffers();
      inputLocked = false;
    }
  };

  // 键盘处理只保留终端演示所需功能：输入、提交、历史、滚屏和清行。
  const handleKeydown = async (event) => {
    parameters.startTime = Date.now();

    if (inputLocked) {
      // 流式输出期间允许 Ctrl+C 取消，其它按键忽略。
      if (event.ctrlKey && event.key.toLowerCase() === "c" && activeStream) {
        event.preventDefault();
        activeStream.abort();
      } else if (event.key === "PageUp" || event.key === "PageDown") {
        event.preventDefault();
        if (event.key === "PageUp") terminal.pageUp();
        else terminal.pageDown();
        updateBuffers();
      } else {
        event.preventDefault();
      }
      return;
    }

    if (event.key === "Enter") {
      event.preventDefault();

      terminal.addString("\n\n");
      updateBuffers();

      const message = inputBuffer;
      inputBuffer = "";

      const result = await demoCommands.send(message);
      if (result && result.stream) {
        if (result.prompt) terminal.promptText = result.prompt;
        pushHistory(message);
        historyIndex = 0;
        await streamChat(result.messages || []);
        return;
      }
      renderCommandResult(result);
      pushHistory(message);
      historyIndex = 0;
    } else if (event.key === "Backspace") {
      event.preventDefault();
      terminal.backspace();
      inputBuffer = inputBuffer.slice(0, -1);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();

      if (historyIndex === history.length) return;

      historyIndex++;
      inputBuffer = history[history.length - historyIndex];
      redrawInputLine();
    } else if (event.key === "ArrowDown") {
      event.preventDefault();

      if (historyIndex === 0) return;

      historyIndex--;
      inputBuffer = history[history.length - historyIndex] || "";
      redrawInputLine();
    } else if (event.key === "PageUp") {
      event.preventDefault();
      terminal.pageUp();
    } else if (event.key === "PageDown") {
      event.preventDefault();
      terminal.pageDown();
    } else if (event.key === "End") {
      event.preventDefault();
      terminal.end();
    } else if (event.key.length === 1 && !event.altKey && !event.metaKey) {
      if (event.ctrlKey && event.key.toLowerCase() === "l") {
        event.preventDefault();
        terminal.clear();
        terminal.addString(promptText(), false);
        terminal.addString(inputBuffer, false);
      } else if (event.ctrlKey && event.key.toLowerCase() === "u") {
        event.preventDefault();
        terminal.clearToStartOfLine();
        terminal.addString(promptText(), false);
        inputBuffer = "";
      } else if (!event.ctrlKey) {
        terminal.addChar(event.key);
        inputBuffer += event.key;
      } else {
        return;
      }
    } else {
      return;
    }

    updateBuffers();
  };

  const createShader = (source, type) => {
    const shader = gl.createShader(type);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);

    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      const typeName = type === gl.VERTEX_SHADER ? "VERTEX" : "FRAGMENT";
      throw new Error(`${typeName} SHADER:\n${gl.getShaderInfoLog(shader)}`);
    }

    return shader;
  };

  const createProgram = (vertexSource, fragmentSource) => {
    const program = gl.createProgram();
    const preamble = "#ifdef GL_ES\nprecision mediump float;\n#endif\n\n";
    const vertexShader = createShader(
      preamble + vertexSource,
      gl.VERTEX_SHADER,
    );
    const fragmentShader = createShader(
      preamble + fragmentSource,
      gl.FRAGMENT_SHADER,
    );

    gl.attachShader(program, vertexShader);
    gl.attachShader(program, fragmentShader);
    gl.deleteShader(vertexShader);
    gl.deleteShader(fragmentShader);
    gl.linkProgram(program);

    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      throw new Error(
        `ERROR:\nVALIDATE_STATUS: ${gl.getProgramParameter(
          program,
          gl.VALIDATE_STATUS,
        )}\nERROR: ${gl.getError()}\nLOG: ${gl.getProgramInfoLog(program)}`,
      );
    }

    return program;
  };

  // WebGL 初始化：创建 shader program、纹理、framebuffer 和顶点缓冲。
  const initWebGL = () => {
    const unitQuadGeometry = new Float32Array([
      1.0, 1.0, 0.0, -1.0, 1.0, 0.0, 1.0, -1.0, 0.0, -1.0, -1.0, 0.0,
    ]);
    const unitQuadTexCoords = new Float32Array([1, 1, 0, 1, 1, 0, 0, 0]);

    gl =
      canvas.getContext("webgl", { alpha: false }) ||
      canvas.getContext("experimental-webgl", { alpha: false });

    if (!gl) {
      throw new Error("Cannot create WebGL context.");
    }

    // 这是 2D 合成，不需要深度测试；终端纹理有透明度，所以需要混合。
    gl.disable(gl.DEPTH_TEST);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);

    // Terminal pass：字符网格 + 字体纹理 -> termTex。
    termProgram = createProgram(assets.termVert, assets.termFrag);
    termTimeLocation = gl.getUniformLocation(termProgram, "uTime");
    termScreenSizeLocation = gl.getUniformLocation(termProgram, "uScreenSize");
    termGridSizeLocation = gl.getUniformLocation(termProgram, "uGridSize");
    termFontTexLocation = gl.getUniformLocation(termProgram, "uFont");
    termGeoLocation = gl.getAttribLocation(termProgram, "aGeo");
    termCharLocation = gl.getAttribLocation(termProgram, "aChar");

    termGeoBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, termGeoBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, terminal.getGeoBuffer(), gl.STATIC_DRAW);
    gl.bindBuffer(gl.ARRAY_BUFFER, null);

    termCharBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, termCharBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, terminal.getCharBuffer(), gl.STATIC_DRAW);
    gl.bindBuffer(gl.ARRAY_BUFFER, null);

    termFontTex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, termFontTex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      gl.RGBA,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      assets.fontImage,
    );
    gl.bindTexture(gl.TEXTURE_2D, null);

    termFrameBuf = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, termFrameBuf);
    termTex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, termTex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(
      gl.TEXTURE_2D,
      gl.TEXTURE_MIN_FILTER,
      gl.LINEAR_MIPMAP_NEAREST,
    );
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      gl.RGBA,
      FRAMEBUFFER_SIZE,
      FRAMEBUFFER_SIZE,
      0,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      null,
    );
    gl.framebufferTexture2D(
      gl.FRAMEBUFFER,
      gl.COLOR_ATTACHMENT0,
      gl.TEXTURE_2D,
      termTex,
      0,
    );
    gl.bindTexture(gl.TEXTURE_2D, null);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);

    // Post pass：termTex -> postTex，主要做扫描线和 CRT 弯曲。
    postProgram = createProgram(assets.postVert, assets.postFrag);
    postTermTexLocation = gl.getUniformLocation(postProgram, "uTermTex");
    postPositionLocation = gl.getAttribLocation(postProgram, "aPosition");
    postTexCoordLocation = gl.getAttribLocation(postProgram, "aTexCoord");

    postPositionBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, postPositionBuffer);
    gl.bufferData(
      gl.ARRAY_BUFFER,
      new Float32Array([
        0.94, 0.66, 1, -0.76, 0.66, 1, 0.94, -0.57, 1, -0.72, -0.65, 1,
      ]),
      gl.STATIC_DRAW,
    );
    gl.bindBuffer(gl.ARRAY_BUFFER, null);

    postTexCoordBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, postTexCoordBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, unitQuadTexCoords, gl.STATIC_DRAW);
    gl.bindBuffer(gl.ARRAY_BUFFER, null);

    postFrameBuf = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, postFrameBuf);
    postTex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, postTex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(
      gl.TEXTURE_2D,
      gl.TEXTURE_MIN_FILTER,
      gl.LINEAR_MIPMAP_NEAREST,
    );
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      gl.RGBA,
      FRAMEBUFFER_SIZE,
      FRAMEBUFFER_SIZE,
      0,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      null,
    );
    gl.framebufferTexture2D(
      gl.FRAMEBUFFER,
      gl.COLOR_ATTACHMENT0,
      gl.TEXTURE_2D,
      postTex,
      0,
    );
    gl.bindTexture(gl.TEXTURE_2D, null);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);

    // Background pass：把真实终端照片铺满屏幕，并在 shader 中做噪点和暗角。
    bgProgram = createProgram(assets.bgVert, assets.bgFrag);
    bgImageTexLocation = gl.getUniformLocation(bgProgram, "uBGImageTex");
    bgScreenSizeLocation = gl.getUniformLocation(bgProgram, "uScreenSize");
    bgTimeLocation = gl.getUniformLocation(bgProgram, "uTime");
    bgSizeLocation = gl.getUniformLocation(bgProgram, "uBGSize");
    bgPositionLocation = gl.getAttribLocation(bgProgram, "aPosition");
    bgTexCoordLocation = gl.getAttribLocation(bgProgram, "aTexCoord");

    bgImageTex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, bgImageTex);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      gl.RGBA,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      assets.bgImage,
    );
    gl.bindTexture(gl.TEXTURE_2D, null);

    bgPositionBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, bgPositionBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, unitQuadGeometry, gl.STATIC_DRAW);
    gl.bindBuffer(gl.ARRAY_BUFFER, null);

    bgTexCoordBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, bgTexCoordBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, unitQuadTexCoords, gl.STATIC_DRAW);
    gl.bindBuffer(gl.ARRAY_BUFFER, null);

    // Composite pass：把 postTex 放到背景图里的屏幕位置，并叠加退磁效果。
    compProgram = createProgram(assets.compositeVert, assets.compositeFrag);
    compDegaussTimeLocation = gl.getUniformLocation(compProgram, "uDegauss");
    compPostTexLocation = gl.getUniformLocation(compProgram, "uPostTex");
    compScreenSizeLocation = gl.getUniformLocation(compProgram, "uScreenSize");
    compBGSizeLocation = gl.getUniformLocation(compProgram, "uBGSize");
    compPositionLocation = gl.getAttribLocation(compProgram, "aPosition");
    compTexCoordLocation = gl.getAttribLocation(compProgram, "aTexCoord");

    compPositionBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, compPositionBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, unitQuadGeometry, gl.STATIC_DRAW);
    gl.bindBuffer(gl.ARRAY_BUFFER, null);

    compTexCoordBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, compTexCoordBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, unitQuadTexCoords, gl.STATIC_DRAW);
    gl.bindBuffer(gl.ARRAY_BUFFER, null);
  };

  const render = () => {
    if (!gl || !termProgram) return;

    parameters.time = Date.now() - parameters.startTime;
    parameters.degaussTime = Date.now() - parameters.startDegaussTime;

    // 1. Terminal Pass：把字符绘制到离屏纹理 termTex。
    gl.bindFramebuffer(gl.FRAMEBUFFER, termFrameBuf);
    gl.viewport(0, 0, FRAMEBUFFER_SIZE, FRAMEBUFFER_SIZE);
    gl.clear(gl.COLOR_BUFFER_BIT);

    gl.useProgram(termProgram);
    gl.uniform1f(termTimeLocation, parameters.time / 1000);
    gl.uniform2f(
      termScreenSizeLocation,
      parameters.screenWidth,
      parameters.screenHeight,
    );
    gl.uniform2f(
      termGridSizeLocation,
      parameters.gridWidth,
      parameters.gridHeight,
    );

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, termFontTex);
    gl.uniform1i(termFontTexLocation, 0);

    gl.bindBuffer(gl.ARRAY_BUFFER, termGeoBuffer);
    gl.vertexAttribPointer(termGeoLocation, 2, gl.FLOAT, false, 0, 0);
    gl.enableVertexAttribArray(termGeoLocation);

    gl.bindBuffer(gl.ARRAY_BUFFER, termCharBuffer);
    gl.vertexAttribPointer(termCharLocation, 2, gl.FLOAT, false, 0, 0);
    gl.enableVertexAttribArray(termCharLocation);

    gl.drawArrays(gl.TRIANGLES, 0, terminal.buffer.length * 3);

    gl.disableVertexAttribArray(termGeoLocation);
    gl.disableVertexAttribArray(termCharLocation);

    gl.bindTexture(gl.TEXTURE_2D, termTex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.generateMipmap(gl.TEXTURE_2D);
    gl.bindTexture(gl.TEXTURE_2D, null);

    // 2. Post Pass：把 termTex 做 CRT 后处理后写入 postTex。
    gl.bindFramebuffer(gl.FRAMEBUFFER, postFrameBuf);
    gl.viewport(0, 0, FRAMEBUFFER_SIZE, FRAMEBUFFER_SIZE);
    gl.clear(gl.COLOR_BUFFER_BIT);

    gl.useProgram(postProgram);

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, termTex);
    gl.uniform1i(postTermTexLocation, 0);

    gl.bindBuffer(gl.ARRAY_BUFFER, postPositionBuffer);
    gl.vertexAttribPointer(postPositionLocation, 3, gl.FLOAT, false, 0, 0);
    gl.enableVertexAttribArray(postPositionLocation);

    gl.bindBuffer(gl.ARRAY_BUFFER, postTexCoordBuffer);
    gl.vertexAttribPointer(postTexCoordLocation, 2, gl.FLOAT, false, 0, 0);
    gl.enableVertexAttribArray(postTexCoordLocation);

    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

    gl.bindTexture(gl.TEXTURE_2D, postTex);
    gl.generateMipmap(gl.TEXTURE_2D);
    gl.bindTexture(gl.TEXTURE_2D, null);

    gl.disableVertexAttribArray(postPositionLocation);
    gl.disableVertexAttribArray(postTexCoordLocation);

    // 3. Composite Pass：先绘制背景，再把终端纹理叠到屏幕区域。
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.clear(gl.COLOR_BUFFER_BIT);

    gl.useProgram(bgProgram);
    gl.uniform1f(bgTimeLocation, parameters.time / 1000);
    gl.uniform2f(
      bgScreenSizeLocation,
      parameters.screenWidth,
      parameters.screenHeight,
    );
    gl.uniform2f(bgSizeLocation, assets.bgImage.width, assets.bgImage.height);

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, bgImageTex);
    gl.uniform1i(bgImageTexLocation, 0);

    gl.bindBuffer(gl.ARRAY_BUFFER, bgPositionBuffer);
    gl.vertexAttribPointer(bgPositionLocation, 3, gl.FLOAT, false, 0, 0);
    gl.enableVertexAttribArray(bgPositionLocation);

    gl.bindBuffer(gl.ARRAY_BUFFER, bgTexCoordBuffer);
    gl.vertexAttribPointer(bgTexCoordLocation, 2, gl.FLOAT, false, 0, 0);
    gl.enableVertexAttribArray(bgTexCoordLocation);

    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

    gl.disableVertexAttribArray(bgPositionLocation);
    gl.disableVertexAttribArray(bgTexCoordLocation);

    gl.useProgram(compProgram);
    gl.uniform1f(compDegaussTimeLocation, parameters.degaussTime / 1000);
    gl.uniform2f(
      compScreenSizeLocation,
      parameters.screenWidth,
      parameters.screenHeight,
    );
    gl.uniform2f(
      compBGSizeLocation,
      assets.bgImage.width,
      assets.bgImage.height,
    );

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, postTex);
    gl.uniform1i(compPostTexLocation, 0);

    gl.bindBuffer(gl.ARRAY_BUFFER, compPositionBuffer);
    gl.vertexAttribPointer(compPositionLocation, 3, gl.FLOAT, false, 0, 0);
    gl.enableVertexAttribArray(compPositionLocation);

    gl.bindBuffer(gl.ARRAY_BUFFER, compTexCoordBuffer);
    gl.vertexAttribPointer(compTexCoordLocation, 2, gl.FLOAT, false, 0, 0);
    gl.enableVertexAttribArray(compTexCoordLocation);

    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

    gl.disableVertexAttribArray(compPositionLocation);
    gl.disableVertexAttribArray(compTexCoordLocation);
  };

  const handleResize = () => {
    if (!gl) return;

    // CSS 决定 canvas 的显示大小；这里把内部像素尺寸同步到设备像素比，
    // 避免高 DPI 屏幕上画面发虚。
    const ratio = window.devicePixelRatio || 1;
    const width = Math.floor(gl.canvas.clientWidth * ratio);
    const height = Math.floor(gl.canvas.clientHeight * ratio);

    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = parameters.screenWidth = width;
      canvas.height = parameters.screenHeight = height;
    }
  };

  const handleDoubleClick = () => {
    parameters.startDegaussTime = Date.now();
  };

  const animate = () => {
    if (!gl) return;

    const now = Date.now();
    const fps = now - parameters.startDegaussTime > 2000 ? 15 : 60;

    if (!animate.lastFrame || now - 1000 / fps > animate.lastFrame) {
      animate.lastFrame = now;
      render();
    }

    animationFrameId = window.requestAnimationFrame(animate);
  };

  const setup = async () => {
    document.body.classList.remove("loading");
    document.body.classList.add("fancy");
    canvas = document.querySelector("canvas");
    if (!canvas) {
      canvas = document.createElement("canvas");
      canvas.tabIndex = 0;
      canvas.setAttribute("aria-label", "Fancy CRT terminal");
      document.body.appendChild(canvas);
    }

    assets = await loadAssets({
      fontImage: "fonts/PrintChar21.png",
      bgImage: "assets/term.jpg",
      bgFrag: "shaders/bg.frag",
      bgVert: "shaders/bg.vert",
      compositeFrag: "shaders/composite.frag",
      compositeVert: "shaders/composite.vert",
      postFrag: "shaders/post.frag",
      postVert: "shaders/post.vert",
      termFrag: "shaders/term.frag",
      termVert: "shaders/term.vert",
    });

    terminal = new Terminal();
    terminal.addString(
      `   _________    _   __________  __   ______  __________  __\n  / __/ _ |  / | / / ___/\ \/ /  /_  __/ __/ _ \/  |/  /\n / _// __ | /  |/ / /__   \  /    / / / _// , _/ /|_/ /\n/_/ /_/ |_|/_/|_/\___/   /_/    /_/ /___/_/|_/_/  /_/\n\n28.8 kbit/s ][  standalone demo\nWebGL CRT display initialized\n\n`,
      false,
    );

    parameters.gridWidth = terminal.width;
    parameters.gridHeight = terminal.height;

    initWebGL();
    handleResize();

    parameters.startDegaussTime = Date.now();
    animate.lastFrame = 0;
    animate();

    window.addEventListener("resize", handleResize);
    window.addEventListener("keydown", handleKeydown);
    window.addEventListener("dblclick", handleDoubleClick);
    window.focus();
    canvas.focus();

    renderOutput(await demoCommands.setup());
  };

  const teardown = () => {
    window.removeEventListener("resize", handleResize);
    window.removeEventListener("keydown", handleKeydown);
    window.removeEventListener("dblclick", handleDoubleClick);

    if (animationFrameId !== null) {
      window.cancelAnimationFrame(animationFrameId);
      animationFrameId = null;
    }

    gl = null;
    document.body.innerHTML = "";
  };

  return { setup, teardown };
})();
