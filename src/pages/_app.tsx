import '@/styles/globals.scss';

import type {AppProps} from 'next/app';
import {type FC, memo, useEffect} from 'react';

const App: FC<AppProps> = memo(({Component, pageProps}) => {
  // public/sw.js is written by scripts/sw.mjs: after `next build` a worker that precaches the build so
  // the game launches offline; before `next dev` one that removes itself from the origin.
  useEffect(() => {
    if (process.env.NODE_ENV !== 'production' || !('serviceWorker' in navigator)) return;
    navigator.serviceWorker
      .register('/sw.js')
      .catch((err: unknown) => console.warn('Mamboka: offline support unavailable', err));
  }, []);
  return <Component {...pageProps} />;
});
App.displayName = 'App';

export default App;
