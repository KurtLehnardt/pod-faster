import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Try Pod-Faster — Generate a Free AI Podcast",
  description:
    "Generate a podcast on any topic in under 2 minutes — no account required. Powered by AI with real-time news search and natural voices.",
  openGraph: {
    title: "Try Pod-Faster — Generate a Free AI Podcast",
    description:
      "Generate a podcast on any topic in under 2 minutes — no account required.",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "Try Pod-Faster — Generate a Free AI Podcast",
    description:
      "Generate a podcast on any topic in under 2 minutes — no account required.",
  },
};

export default function TryLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <>{children}</>;
}
