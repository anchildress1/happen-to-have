import type { Metadata } from 'next';
import { Paprika, Source_Sans_3 } from 'next/font/google';
import type { ReactNode } from 'react';
import '../src/ui/tokens.css';

// Paprika carries the product name and display chrome only. It is a Google
// Display face and ships weight 400 alone — the imported design's 300-weight
// treatment is gone, and must not be faked with a lighter colour or a
// synthetic stroke (research D13).
//
// Participant content is deliberately NOT set in Paprika, even at display
// sizes: 002 translates contributions, and Paprika has no Cyrillic, Vietnamese,
// or CJK. The sister face carries every string a participant wrote.
//
const paprika = Paprika({
  subsets: ['latin'],
  weight: '400',
  variable: '--font-paprika',
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
    <html lang="en" className={`${paprika.variable} ${sourceSans.variable}`}>
      <body>{children}</body>
    </html>
  );
}
