import type { Metadata } from "next";
import { IBM_Plex_Mono, IBM_Plex_Sans } from "next/font/google";

import "./globals.css";

const plexSans = IBM_Plex_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-plex-sans",
});
const plexMono = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["400", "500"],
  variable: "--font-plex-mono",
});

export const metadata: Metadata = {
  // A template so each route names itself. Every page previously inherited the
  // landing title, so the tab said "evidence-grounded AI health & training
  // coach" whether you were signing in or reading your profile, and a window
  // full of tabs was unnavigable (issue #2, P1).
  title: {
    default: "Lodestar — evidence-grounded AI health & training coach",
    template: "%s · Lodestar",
  },
  description:
    "An evidence-grounded AI coach for training, nutrition & recovery — cited answers, real tools, measured quality.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body
        className={`${plexSans.variable} ${plexMono.variable} min-h-screen font-sans antialiased`}
      >
        {children}
      </body>
    </html>
  );
}
