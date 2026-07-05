import type { Metadata } from "next";

import DemoChat from "@/components/DemoChat";

export const metadata: Metadata = {
  title: "Lodestar — live demo",
  description: "Try the evidence-grounded AI coach — no signup required.",
};

export default function DemoPage() {
  return <DemoChat />;
}
