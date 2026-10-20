import {Head, Html, Main, NextScript} from 'next/document';

import devices from '../../scripts/splash-devices.json';

// iOS picks the launch image whose media query matches the device exactly; scripts/splash.mjs renders
// one file per size and orientation into public/splash before dev/build.
const STARTUP_IMAGES: {href: string; media: string}[] = [];
for (const {width, height, scale} of devices) {
  for (const orientation of ['portrait', 'landscape'] as const) {
    const [w, h] = orientation === 'portrait' ? [width, height] : [height, width];
    STARTUP_IMAGES.push({
      href: `/splash/${w * scale}x${h * scale}.png`,
      media: `(device-width: ${width}px) and (device-height: ${height}px) and (-webkit-device-pixel-ratio: ${scale}) and (orientation: ${orientation})`,
    });
  }
}

export default function Document() {
  return (
    <Html lang="en">
      <Head>
        <meta charSet="utf-8" />
        {/* Google Translate rewrites the DOM under React's feet: https://github.com/facebook/react/issues/11538 */}
        <meta content="notranslate" name="google" />
        <meta content="#c9884a" name="theme-color" />
        <link href="/manifest.webmanifest" rel="manifest" />
        {/* Icons are rendered from public/icon.png by scripts/icons.mjs before dev/build. */}
        <link href="/favicon.ico" rel="icon" sizes="32x32" />
        <link href="/icons/favicon-32.png" rel="icon" sizes="32x32" type="image/png" />
        <link href="/icons/icon-192.png" rel="icon" sizes="192x192" type="image/png" />
        {/* Added to an iOS home screen the game opens full-screen, under a translucent status bar (the HUD
            keeps clear of it through env(safe-area-inset-top)); the launch images match the page background. */}
        <link href="/icons/apple-touch-icon.png" rel="apple-touch-icon" sizes="180x180" />
        <meta content="yes" name="mobile-web-app-capable" />
        <meta content="yes" name="apple-mobile-web-app-capable" />
        <meta content="Mamboka" name="apple-mobile-web-app-title" />
        <meta content="black-translucent" name="apple-mobile-web-app-status-bar-style" />
        {STARTUP_IMAGES.map(({href, media}) => (
          <link href={href} key={href} media={media} rel="apple-touch-startup-image" />
        ))}
      </Head>
      <body className="bg-[#c9884a]">
        <Main />
        <NextScript />
      </body>
    </Html>
  );
}
