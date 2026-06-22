import type { Metadata } from 'next';
import type { ReactNode } from 'react';

import './globals.css';

export const metadata: Metadata = {
  title: 'Dragonslayer — Leaderboards',
  description: 'Speedrun-style boards for daily gold hauls and vim trials.',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <header className="masthead">
          <a href="/" className="brand">
            ⚔ Dragonslayer Leaderboards
          </a>
          <nav>
            <a href="/">Gold / Day</a>
            <a href="/trials">Trials</a>
          </nav>
        </header>
        <main>{children}</main>
        <footer className="footer">
          Good-faith + media. Slay true; coverage is the only cheat-proof gold.
        </footer>
      </body>
    </html>
  );
}
