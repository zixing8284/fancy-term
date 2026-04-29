// 本地演示命令
// -----------------------------------------------------------------------------
// 处理普通 shell 命令以及 AI chat 模式。chat 模式下把输入变成
// { stream: true, prompt } 让 fancy.js 调 /api/chat 流式渲染。

const demoCommands = (() => {
  const SHELL_PROMPT = ">";
  const CHAT_PROMPT = "ai>";
  const HISTORY_KEY = "fancy-term-chat-history";
  const MAX_HISTORY_TURNS = 12;

  let mode = "shell";
  let chatHistory = (() => {
    try {
      const raw = sessionStorage.getItem(HISTORY_KEY);
      const parsed = raw ? JSON.parse(raw) : [];
      return Array.isArray(parsed) ? parsed : [];
    } catch (error) {
      return [];
    }
  })();

  const persistHistory = () => {
    try {
      sessionStorage.setItem(HISTORY_KEY, JSON.stringify(chatHistory));
    } catch (error) {
      /* ignore quota errors */
    }
  };

  const trimHistory = () => {
    const max = MAX_HISTORY_TURNS * 2;
    if (chatHistory.length > max) {
      chatHistory = chatHistory.slice(chatHistory.length - max);
    }
  };

  const pushHistory = (role, content) => {
    chatHistory.push({ role, content });
    trimHistory();
    persistHistory();
  };

  const pushAssistantMessage = (content) => {
    if (typeof content !== "string" || !content) return;
    pushHistory("assistant", content);
  };

  const clearHistory = () => {
    chatHistory = [];
    persistHistory();
  };

  const currentPrompt = () => (mode === "chat" ? CHAT_PROMPT : SHELL_PROMPT);

  const withPrompt = (lines) => `${lines.join("\n")}\n${currentPrompt()}`;

  const setup = async () => {
    return withPrompt([
      "FANCY TERM",
      "",
      "WebGL CRT terminal. Built on langterm by Ian Langworth.",
      "https://github.com/statico/langterm  (MIT License)",
      "",
      "Type help to list commands.",
      "Type chat to meet MURA.",
    ]);
  };

  const send = async (message) => {
    const rawMessage = String(message || "");
    const trimmedMessage = rawMessage.trim();

    // ---- chat mode ---------------------------------------------------------
    if (mode === "chat") {
      if (!trimmedMessage) {
        return { output: CHAT_PROMPT, prompt: CHAT_PROMPT };
      }
      const lower = trimmedMessage.toLowerCase();
      if (lower === "exit" || lower === "quit") {
        mode = "shell";
        return {
          output: withPrompt(["Leaving AI chat mode."]),
          prompt: SHELL_PROMPT,
        };
      }
      if (lower === "clear" || lower === "cls") {
        return {
          clear: true,
          output: CHAT_PROMPT,
          prompt: CHAT_PROMPT,
        };
      }
      if (lower === "reset") {
        clearHistory();
        return {
          output: withPrompt(["Chat history cleared."]),
          prompt: CHAT_PROMPT,
        };
      }
      pushHistory("user", trimmedMessage);
      return {
        stream: true,
        messages: chatHistory.slice(),
        prompt: CHAT_PROMPT,
      };
    }

    // ---- shell mode --------------------------------------------------------
    const commandName = trimmedMessage.split(/\s+/)[0].toLowerCase();

    if (!trimmedMessage) {
      return { output: SHELL_PROMPT, prompt: SHELL_PROMPT };
    }

    if (commandName === "clear" || commandName === "cls") {
      return {
        clear: true,
        output: withPrompt(["FANCY TERM", "", "Screen cleared."]),
        prompt: SHELL_PROMPT,
      };
    }

    if (commandName === "help") {
      return {
        output: withPrompt([
          "HELP",
          "",
          "help       show this command list",
          "about      project info and credits",
          "clear      clear the terminal buffer",
          "date       print the browser time",
          "echo TEXT  print TEXT back to the terminal",
          "chat       enter AI chat mode (exit to leave)",
        ]),
        prompt: SHELL_PROMPT,
      };
    }

    if (commandName === "about") {
      return {
        output: withPrompt([
          "ABOUT",
          "",
          "This terminal is built entirely on langterm by Ian Langworth.",
          "All WebGL rendering, GLSL shaders, bitmap font, background",
          "image, CRT effects, and terminal logic originate from that",
          "project and are used here under the MIT License.",
          "",
          "  Original project:",
          "  https://github.com/statico/langterm",
          "  (c) Ian Langworth -- MIT License",
          "",
          "The only addition in this fork is MURA -- an AI companion",
          "who lives somewhere in the early 2000s, warm and unhurried.",
          "Type chat to say hello.",
        ]),
        prompt: SHELL_PROMPT,
      };
    }

    if (commandName === "date") {
      return {
        output: withPrompt([new Date().toString()]),
        prompt: SHELL_PROMPT,
      };
    }

    if (commandName === "echo") {
      const echoText = trimmedMessage.replace(/^echo\s*/i, "");
      return { output: withPrompt([echoText || ""]), prompt: SHELL_PROMPT };
    }

    if (commandName === "chat") {
      mode = "chat";
      return {
        output: withPrompt([
          "MURA",
          "",
          "Hello. It is quiet in here -- the good kind of quiet.",
          "I am MURA. Take your time.",
          "",
          "Type exit to leave, reset to clear our conversation.",
        ]),
        prompt: CHAT_PROMPT,
      };
    }

    return {
      output: withPrompt([
        "UNKNOWN COMMAND",
        "",
        `No local command named "${commandName}".`,
        "Type help for available commands.",
      ]),
      prompt: SHELL_PROMPT,
    };
  };

  return { setup, send, currentPrompt, pushAssistantMessage };
})();
