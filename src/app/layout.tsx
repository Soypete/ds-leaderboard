import type { Metadata } from 'next';
import type { ReactNode } from 'react';

import './globals.css';

export const metadata: Metadata = {
  title: 'Dragonslayer — Leaderboards',
  description: 'Speedrun-style boards for daily gold hauls and vim trials.',
};

// Cinzel — an inscriptional Roman serif, used ONLY for the champion handle and
// page heralds. Loaded from Google Fonts; display=swap so the mono field paints
// immediately and the engraved serif fills in.
const HERALD_FONT =
  'https://fonts.googleapis.com/css2?family=Cinzel:wght@500;600;700&display=swap';

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link rel="stylesheet" href={HERALD_FONT} />
      </head>
      <body>
        <header className="masthead">
          <a href="/" className="brand">
            <span className="brand-mark" aria-hidden="true">
              ⚔
            </span>
            <span className="brand-name">Dragonslayer</span>
            <span className="brand-sub">standings</span>
          </a>
          <nav>
            <a href="/">Gold</a>
            <a href="/trials">Trials</a>
            <a href="/guilds">Guilds</a>
            <a href="/login" className="nav-oath">
              Take the oath
            </a>
          </nav>
        </header>
        <main>{children}</main>
        <footer className="footer">
          <p className="footer-creed">
            Good-faith + media. Slay true; coverage is the only cheat-proof gold.
          </p>
          <nav className="footer-links">
            <a
              href="https://github.com/Soypete/ds-submissions#how-to-submit"
              target="_blank"
              rel="noreferrer"
            >
              ⚑ How to submit a run
            </a>
            <a
              href="https://github.com/Soypete/ds-leaderboard"
              target="_blank"
              rel="noreferrer"
            >
              ⌥ Source on GitHub
            </a>
          </nav>
          <p className="footer-copyright">
            © 2026 Soypete Tech. All rights reserved.
          </p>
        </footer>
      </body>
    </html>
  );
}
