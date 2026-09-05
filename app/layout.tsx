import type { Metadata } from 'next';
import { Sour_Gummy, Source_Sans_3 } from 'next/font/google';
import type { ReactNode } from 'react';
import '../src/ui/tokens.css';

// Display chrome only; participant content stays on Source Sans 3 at any size, since
// 002 translates contributions and this ships latin and latin-ext alone.
//
// `axes` is rejected unless weight is 'variable', so both axes ship live and
// --weight-display / --width-display pick the instance in tokens.css.
const sourGummy = Sour_Gummy({
  subsets: ['latin'],
  weight: 'variable',
  axes: ['wdth'],
  variable: '--font-sour-gummy',
  display: 'swap',
});

// Source Sans 3 carries every string a participant wrote, at any size, plus all
// body and UI text. Chosen for reach: latin, latin-ext, cyrillic, cyrillic-ext,
// greek, greek-ext, and vietnamese — well past what 002 translates into.
//
// Its digits are monospaced by default (every glyph 0-9 advances 472 units), so
// the recorder timer in 003 does not jitter. This matters because Google strips
// GSUB features from its subsets: `font-variant-numeric: tabular-nums` is a
// no-op on the served font. The default figures already do the job.
const sourceSans = Source_Sans_3({
  subsets: ['latin', 'latin-ext', 'cyrillic', 'greek', 'vietnamese'],
  weight: 'variable',
  variable: '--font-source-sans',
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'Happen to Have?',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={`${sourGummy.variable} ${sourceSans.variable}`}>
      <body>{children}</body>
    </html>
  );
}
