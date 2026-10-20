import {Head, Html, Main, NextScript} from 'next/document';

export default function Document() {
  return (
    <Html lang="en">
      <Head>
        <meta charSet="utf-8" />
        {/* Google Translate rewrites the DOM under React's feet: https://github.com/facebook/react/issues/11538 */}
        <meta content="notranslate" name="google" />
        <meta content="#c9884a" name="theme-color" />
        <link href="/manifest.webmanifest" rel="manifest" />
        <link href="/icon.png" rel="icon" type="image/png" />
        {/* Added to an iOS home screen the game opens full-screen, without Safari's bars around the play field. */}
        <link href="/icon.png" rel="apple-touch-icon" />
        <meta content="yes" name="mobile-web-app-capable" />
        <meta content="yes" name="apple-mobile-web-app-capable" />
        <meta content="Mamboka" name="apple-mobile-web-app-title" />
        <meta content="black-translucent" name="apple-mobile-web-app-status-bar-style" />
      </Head>
      <body className="bg-[#c9884a]">
        <Main />
        <NextScript />
      </body>
    </Html>
  );
}
