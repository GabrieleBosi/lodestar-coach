import type { Metadata } from "next";

import "./globals.css";

export const metadata: Metadata = {
  title: "Lodestar — evidence-grounded AI health & training coach",
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
