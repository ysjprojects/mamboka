import dynamic from 'next/dynamic';
import {RocknRoll_One} from 'next/font/google';
import Head from 'next/head';
import {type FC, memo} from 'react';

const TITLE = 'Mamboka — merge your way to Mambo';
const DESCRIPTION =
  'Mamboka: a Suika Game parody. Drop chibi horse girls into a glass box and merge matching ones up the ladder from Mejiro McQueen to Mambo. Real silhouette physics, Switch-style scoring, works on phones.';
const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL;

// Suika Game's in-game text is Fontworks RocknRoll; RocknRoll One is the OFL cut on Google Fonts.
const rocknroll = RocknRoll_One({subsets: ['latin'], weight: '400'});

const loading = () => (
  <div className="flex h-dvh items-center justify-center bg-[#c9884a] text-[#fff5e2]">
    <span className="animate-pulse text-sm">warming up Poppy…</span>
  </div>
);

// Matter.js, canvas and the silhouette tracer are browser-only; the game never renders on the server.
// eslint-disable-next-line react-memo/require-memo
const MambokaGame = dynamic(() => import('@/components/MambokaGame'), {loading, ssr: false});

const Page: FC = memo(() => (
  <>
    <Head>
      <title>{TITLE}</title>
      <meta content={DESCRIPTION} name="description" />
      {SITE_URL !== undefined ? <link href={`${SITE_URL}/`} key="canonical" rel="canonical" /> : null}
      <meta content={TITLE} property="og:title" />
      <meta content={DESCRIPTION} property="og:description" />
      {SITE_URL !== undefined ? <meta content={`${SITE_URL}/`} property="og:url" /> : null}
      <meta content={TITLE} name="twitter:title" />
      <meta content={DESCRIPTION} name="twitter:description" />
      <meta
        content="width=device-width, initial-scale=1, maximum-scale=1, viewport-fit=cover, user-scalable=no"
        name="viewport"
      />
    </Head>
    <div className={rocknroll.className}>
      <MambokaGame fontFamily={rocknroll.style.fontFamily} />
    </div>
  </>
));
Page.displayName = 'Page';

export default Page;
