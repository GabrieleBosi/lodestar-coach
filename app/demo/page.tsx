import type { Metadata } from "next";

import DemoChat from "@/components/DemoChat";

export const metadata: Metadata = {
  // Short, because the root layout appends " · Lodestar". Carrying the brand
  // here too produced "Lodestar — live demo · Lodestar".
  title: "Live demo",
  description: "Try the evidence-grounded AI coach — no signup required.",
};

export default function DemoPage() {
  return <DemoChat />;
}
