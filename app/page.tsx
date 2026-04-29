import Script from "next/script";

export default function Page() {
  return (
    <>
      <canvas tabIndex={0} aria-label="Fancy CRT terminal" />
      <noscript>
        <div className="noscript-message">
          <h1>Fancy Term</h1>
          <p>这个演示需要启用 JavaScript，并需要浏览器支持 WebGL。</p>
        </div>
      </noscript>
      <Script src="/js/loader.js" strategy="afterInteractive" />
      <Script src="/js/terminal.js" strategy="afterInteractive" />
      <Script src="/js/demo-commands.js" strategy="afterInteractive" />
      <Script src="/js/fancy.js" strategy="afterInteractive" />
      <Script src="/js/main.js" strategy="afterInteractive" />
    </>
  );
}
