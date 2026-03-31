import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { Toaster } from "@/components/ui/sonner";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || "https://pod-faster.com";

export const metadata: Metadata = {
  title: {
    default: "Pod-Faster — AI-Powered Podcast Generation",
    template: "%s | Pod-Faster",
  },
  description:
    "Turn any news topic into a multi-voice podcast in under 2 minutes. AI-powered generation with real-time search, natural voices, and multiple formats.",
  metadataBase: new URL(siteUrl),
  openGraph: {
    type: "website",
    locale: "en_US",
    url: siteUrl,
    siteName: "Pod-Faster",
    title: "Pod-Faster — AI-Powered Podcast Generation",
    description:
      "Turn any news topic into a multi-voice podcast in under 2 minutes.",
  },
  twitter: {
    card: "summary_large_image",
    title: "Pod-Faster — AI-Powered Podcast Generation",
    description:
      "Turn any news topic into a multi-voice podcast in under 2 minutes.",
  },
  robots: {
    index: true,
    follow: true,
  },
};

const jsonLdOrganization = {
  "@context": "https://schema.org",
  "@type": "Organization",
  name: "Pod-Faster",
  url: siteUrl,
  description:
    "AI-powered podcast generation platform that turns any topic into a multi-voice podcast in minutes.",
  sameAs: ["https://github.com/krleh/pod-faster"],
};

const jsonLdSoftwareApplication = {
  "@context": "https://schema.org",
  "@type": "SoftwareApplication",
  name: "Pod-Faster",
  url: siteUrl,
  applicationCategory: "MultimediaApplication",
  operatingSystem: "Web",
  description:
    "Generate AI-powered podcasts from any topic with real-time news search and natural multi-voice audio.",
  offers: {
    "@type": "Offer",
    price: "0",
    priceCurrency: "USD",
  },
  featureList: [
    "AI podcast generation",
    "Real-time news search",
    "Multiple podcast formats (monologue, interview, group chat)",
    "Natural multi-voice audio via ElevenLabs",
    "RSS feed summary episodes",
    "Multi-language support",
  ],
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="dark">
      <head>
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{
            __html: JSON.stringify(jsonLdOrganization),
          }}
        />
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{
            __html: JSON.stringify(jsonLdSoftwareApplication),
          }}
        />
      </head>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        {children}
        <Toaster />
      </body>
    </html>
  );
}
