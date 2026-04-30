// 简化入口
// -----------------------------------------------------------------------------
// langterm 原项目会根据设备能力在 original、simple、fancy 三种模式中切换。
// fancy-term 只保留 WebGL CRT 终端，所以入口只做一件事：页面加载后启动 fancyView。

const escapeHTML = (value) => {
  return String(value).replace(/[<>&]/g, (char) => {
    if (char === "<") return "&lt;";
    if (char === ">") return "&gt;";
    return "&amp;";
  });
};

const renderFatalError = (error) => {
  const message = error instanceof Error ? error.stack || error.message : error;

  document.body.className = "runtime-error";
  document.body.innerHTML = `
    <main class="runtime-error">
      <h1>Fancy Term failed to start</h1>
      <p>请确认浏览器支持 WebGL，并通过 HTTP 服务器访问本目录。</p>
      <pre>${escapeHTML(message)}</pre>
    </main>
  `;
};

const init = async () => {
  try {
    await fancyView.setup();
  } catch (error) {
    console.error(error);
    renderFatalError(error);
  }
};

// Next.js 的 afterInteractive 策略在 load 事件触发后才注入脚本，
// 因此直接用 addEventListener("load") 会错过已触发的事件，导致黑屏。
// 这里先检查 readyState，若页面已加载完毕则立即执行，否则等待 load 事件。
if (document.readyState === "complete") {
  init();
} else {
  window.addEventListener("load", init);
}

window.addEventListener("beforeunload", () => {
  fancyView.teardown();
});
