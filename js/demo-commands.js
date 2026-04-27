// 本地演示命令
// -----------------------------------------------------------------------------
// 原项目会把用户输入发给互动小说后端。这个独立版本不需要后端，也不包含游戏
// 逻辑，所以这里提供一个很小的本地命令处理器，保持“输入 -> 输出 -> 提示符”
// 的终端体验。

const demoCommands = (() => {
  const prompt = ">";

  const withPrompt = (lines) => {
    return `${lines.join("\n")}\n${prompt}`;
  };

  const setup = async () => {
    return withPrompt([
      "FANCY TERM",
      "",
      "Standalone CRT terminal front-end demo.",
      "Type help to list local demo commands.",
    ]);
  };

  const send = async (message) => {
    const rawMessage = String(message || "");
    const trimmedMessage = rawMessage.trim();
    const commandName = trimmedMessage.split(/\s+/)[0].toLowerCase();

    if (!trimmedMessage) {
      return { output: prompt };
    }

    if (commandName === "clear" || commandName === "cls") {
      return {
        clear: true,
        output: withPrompt(["FANCY TERM", "", "Screen cleared."]),
      };
    }

    if (commandName === "help") {
      return {
        output: withPrompt([
          "HELP",
          "",
          "help       show this command list",
          "about      describe this standalone demo",
          "clear      clear the terminal buffer",
          "date       print the browser time",
          "echo TEXT  print TEXT back to the terminal",
        ]),
      };
    }

    if (commandName === "about") {
      return {
        output: withPrompt([
          "ABOUT",
          "",
          "This page keeps the fancy WebGL CRT terminal from langterm.",
          "It removes the game server, API calls, original page, and simple mode.",
          "The commands here are local JavaScript demos only.",
        ]),
      };
    }

    if (commandName === "date") {
      return { output: withPrompt([new Date().toString()]) };
    }

    if (commandName === "echo") {
      const echoText = trimmedMessage.replace(/^echo\s*/i, "");
      return { output: withPrompt([echoText || ""]) };
    }

    return {
      output: withPrompt([
        "UNKNOWN COMMAND",
        "",
        `No local command named "${commandName}".`,
        "Type help for available commands.",
      ]),
    };
  };

  return { setup, send };
})();
