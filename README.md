# fancy-term

`fancy-term` 是从 `langterm` 中提取出来的独立 WebGL 复古 CRT 网页终端展示。

这个版本只保留 fancy 模式：位图字体、终端字符缓冲、WebGL 渲染管线、CRT 后处理、背景合成、键盘输入、命令历史、分页滚动和双击退磁效果。

## 保留内容

- WebGL 伪 CRT 终端外观
- `Terminal` 字符网格与滚动缓冲
- 位图字体纹理渲染
- 背景图、扫描线、弯曲、退磁等 shader 效果
- 本地命令输入体验

## 移除内容

- 后端 API 调用
- 游戏会话与互动小说逻辑
- original 静态主页模式
- simple 文本输入模式
- 设备能力检测与多模式切换

## 运行方式

请通过 HTTP 服务器访问，不要直接用 `file://` 打开，否则浏览器通常会阻止 shader 文件加载。

目录内部启动服务器：

```bash
python -m http.server 8000
```

然后访问：

```text
http://localhost:8000/
```

## 内置命令

- `help`：查看命令列表
- `about`：查看项目说明
- `clear`：清屏
- `date`：显示当前浏览器时间
- `echo TEXT`：回显文本

## 文件结构

```text
fancy-term/
├── index.html
├── css/main.css
├── js/loader.js
├── js/terminal.js
├── js/demo-commands.js
├── js/fancy.js
├── js/main.js
├── shaders/
├── fonts/
└── assets/
```

## 学习入口

推荐阅读顺序：

1. `index.html`：了解脚本加载顺序。
2. `js/main.js`：了解独立版本如何启动。
3. `js/demo-commands.js`：了解无后端命令输出。
4. `js/terminal.js`：了解字符网格和滚动缓冲。
5. `js/fancy.js`：了解 WebGL 初始化和渲染流水线。

`shaders/` 目录中的 GLSL 文件保持原样，主要用于终端文字渲染、背景处理、CRT 后处理和最终合成。
