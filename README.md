# fancy-term

WebGL 复古 CRT 终端，在 [langterm](https://github.com/statico/langterm) 基础上，接入了 AI (DeepSeek) 对话功能。

> **Credits** — 所有视觉风格、WebGL 渲染管线、GLSL 着色器、位图字体和 CRT 效果均来自 [langterm](https://github.com/statico/langterm)（[Ian Langworth](https://github.com/statico)，MIT License）。本项目仅移除了原项目互动游戏，添加了 AI chat 功能，所有原始资源的著作权归原作者所有。

## 快速开始

```bash
pnpm install
cp .env.local.example .env.local  # 填入 DEEPSEEK_API_KEY
pnpm dev                          # http://localhost:3000
```

## 内置命令

| 命令        | 说明               |
| ----------- | ------------------ |
| `help`      | 查看命令列表       |
| `about`     | 项目说明与版权信息 |
| `clear`     | 清屏               |
| `date`      | 显示当前时间       |
| `echo TEXT` | 回显文本           |
| `chat`      | 进入 AI 对话模式   |

**AI 对话模式**：输入 `chat` 进入，`exit` 退出，`reset` 清空历史。多轮上下文保存在 `sessionStorage`，关闭标签页后清除。Ctrl+C 中断流式输出。

## 文件结构

```
app/
  page.tsx              挂载 canvas 与脚本
  api/chat/route.ts     DeepSeek text stream API
public/
  js/demo-commands.js   命令处理 + AI chat 状态机
  js/fancy.js           WebGL 渲染 + streamChat
  js/terminal.js        字符网格与滚动缓冲
  shaders/              GLSL 着色器（来自 langterm，未修改）
```

## License

本项目新增代码以 MIT License 发布。原始 langterm 资源版权归 Ian Langworth 所有，详见 [langterm/LICENSE](https://github.com/statico/langterm/blob/master/LICENSE)。
