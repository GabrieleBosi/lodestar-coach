import type { Metadata } from "next";

import "./globals.css";

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
      <body className="min-h-screen antialiased">{children}</body>
    </html>
  );
}
