// 资源加载器
// -----------------------------------------------------------------------------
// fancy 终端需要同时加载两类资源：
// 1. 图片：背景图、位图字体。
// 2. 文本：GLSL shader 源码。
// 这个文件把两种加载方式统一成 loadAssets()，让 WebGL 初始化阶段可以一次性拿到
// 所有资源，避免 shader 或纹理还没准备好就开始创建 WebGL 对象。

const loadImage = async (url) => {
  return new Promise((resolve, reject) => {
    const image = new Image();

    image.onerror = () => {
      reject(new Error(`图片加载失败：${url}`));
    };

    image.onload = () => {
      resolve(image);
    };

    image.src = url;
  });
};

const loadText = async (url) => {
  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(`文本资源加载失败：${url} (${response.status})`);
  }

  return response.text();
};

// 传入一个“资源名 -> URL”的对象，返回一个“资源名 -> 已加载内容”的对象。
// 例如：{ bgImage: "assets/term.jpg", termFrag: "shaders/term.frag" }
// 会被加载成：{ bgImage: HTMLImageElement, termFrag: "shader source..." }
const loadAssets = async (assets) => {
  const loadedAssets = {};
  const imagePattern = /\.(png|jpg|jpeg|webp)$/i;

  const loadingTasks = Object.keys(assets).map(async (assetName) => {
    const url = assets[assetName];
    const loader = imagePattern.test(url) ? loadImage : loadText;
    loadedAssets[assetName] = await loader(url);
  });

  await Promise.all(loadingTasks);
  return loadedAssets;
};
