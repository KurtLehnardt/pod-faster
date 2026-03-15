import Link from "next/link";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from "@/components/ui/card";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils/index";
import {
  Mic,
  Search,
  Users,
  Zap,
  MessageSquare,
  SlidersHorizontal,
  Headphones,
  Github,
  ArrowDown,
} from "lucide-react";

const features = [
  {
    icon: Mic,
    title: "Multiple Styles",
    description:
      "Choose from monologue, interview, or group chat formats to match your listening preference.",
  },
  {
    icon: Search,
    title: "Real-Time News",
    description:
      "Searches the latest articles on any topic so your podcast is always fresh and current.",
  },
  {
    icon: Users,
    title: "Multiple Voices",
    description:
      "Natural multi-voice conversations powered by ElevenLabs for an authentic listening experience.",
  },
  {
    icon: Zap,
    title: "Fast Generation",
    description:
      "From topic to podcast in under 2 minutes. Describe what you want and hit play.",
  },
];

const steps = [
  {
    number: 1,
    icon: MessageSquare,
    title: "Describe your topic",
    description:
      "Type or speak the subject you want to explore. News, tech, sports, culture — anything goes.",
  },
  {
    number: 2,
    icon: SlidersHorizontal,
    title: "Choose your style",
    description:
      "Pick your format, tone, and voices. Customize the podcast to fit exactly how you like to listen.",
  },
  {
    number: 3,
    icon: Headphones,
    title: "Listen to your podcast",
    description:
      "Sit back and enjoy a personalized, multi-voice podcast generated just for you.",
  },
];

export default function Home() {
  return (
    <div className="flex min-h-screen flex-col">
      {/* Hero Section */}
      <section className="relative flex min-h-screen flex-col items-center justify-center overflow-hidden px-4 text-center">
        {/* Gradient background */}
        <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-violet-950/40 via-background to-background" />
        <div className="pointer-events-none absolute top-0 left-1/2 h-[600px] w-[800px] -translate-x-1/2 rounded-full bg-violet-600/10 blur-3xl" />

        <div className="relative z-10 flex max-w-3xl flex-col items-center gap-6">
          <div className="inline-flex items-center gap-2 rounded-full border border-border bg-muted/50 px-4 py-1.5 text-sm text-muted-foreground">
            <Zap className="size-3.5" />
            AI-Powered Podcast Generation
          </div>

          <h1 className="text-4xl font-bold tracking-tight sm:text-5xl md:text-6xl">
            Turn Any News Topic Into a{" "}
            <span className="bg-gradient-to-r from-violet-400 to-indigo-400 bg-clip-text text-transparent">
              Podcast in Minutes
            </span>
          </h1>

          <p className="max-w-xl text-lg text-muted-foreground sm:text-xl">
            AI-powered podcast generation. Describe what you want to hear, and
            we'll create a multi-voice podcast with the latest news.
          </p>

          <div className="flex flex-col gap-3 sm:flex-row">
            <Link
              href="/signup"
              className={cn(
                buttonVariants({ size: "lg" }),
                "h-11 px-6 text-base"
              )}
            >
              Get Started
            </Link>
            <a
              href="#features"
              className={cn(
                buttonVariants({ variant: "outline", size: "lg" }),
                "h-11 px-6 text-base"
              )}
            >
              Learn More
              <ArrowDown className="ml-1 size-4" />
            </a>
          </div>
        </div>

        {/* Scroll indicator */}
        <div className="absolute bottom-8 left-1/2 -translate-x-1/2">
          <a
            href="#features"
            className="text-muted-foreground transition-colors hover:text-foreground"
            aria-label="Scroll to features"
          >
            <ArrowDown className="size-5 animate-bounce" />
          </a>
        </div>
      </section>

      {/* Features Section */}
      <section
        id="features"
        className="scroll-mt-16 px-4 py-24 sm:px-6 lg:px-8"
      >
        <div className="mx-auto max-w-5xl">
          <div className="mb-16 text-center">
            <h2 className="text-3xl font-bold tracking-tight sm:text-4xl">
              Everything you need to create podcasts
            </h2>
            <p className="mt-4 text-lg text-muted-foreground">
              Powerful features that make podcast creation effortless.
            </p>
          </div>

          <div className="grid gap-6 sm:grid-cols-2">
            {features.map((feature) => (
              <Card key={feature.title} className="border-0">
                <CardHeader>
                  <div className="mb-2 flex size-10 items-center justify-center rounded-lg bg-violet-600/10">
                    <feature.icon className="size-5 text-violet-400" />
                  </div>
                  <CardTitle>{feature.title}</CardTitle>
                  <CardDescription>{feature.description}</CardDescription>
                </CardHeader>
              </Card>
            ))}
          </div>
        </div>
      </section>

      {/* How It Works Section */}
      <section
        id="how-it-works"
        className="scroll-mt-16 border-t border-border px-4 py-24 sm:px-6 lg:px-8"
      >
        <div className="mx-auto max-w-5xl">
          <div className="mb-16 text-center">
            <h2 className="text-3xl font-bold tracking-tight sm:text-4xl">
              How it works
            </h2>
            <p className="mt-4 text-lg text-muted-foreground">
              Three simple steps to your personalized podcast.
            </p>
          </div>

          <div className="grid gap-8 sm:grid-cols-3">
            {steps.map((step) => (
              <div key={step.number} className="flex flex-col items-center text-center">
                <div className="mb-4 flex size-14 items-center justify-center rounded-full bg-gradient-to-br from-violet-600/20 to-indigo-600/20 ring-1 ring-violet-500/20">
                  <step.icon className="size-6 text-violet-400" />
                </div>
                <div className="mb-2 text-sm font-medium text-violet-400">
                  Step {step.number}
                </div>
                <h3 className="mb-2 text-lg font-semibold">{step.title}</h3>
                <p className="text-sm text-muted-foreground">
                  {step.description}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA Section */}
      <section className="px-4 py-24 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-2xl text-center">
          <h2 className="text-3xl font-bold tracking-tight sm:text-4xl">
            Ready to create your first podcast?
          </h2>
          <p className="mt-4 text-lg text-muted-foreground">
            Start generating personalized podcasts on any topic in minutes.
          </p>
          <div className="mt-8">
            <Link
              href="/signup"
              className={cn(
                buttonVariants({ size: "lg" }),
                "h-11 px-8 text-base"
              )}
            >
              Get Started
            </Link>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-border px-4 py-8 sm:px-6 lg:px-8">
        <div className="mx-auto flex max-w-5xl flex-col items-center gap-4 sm:flex-row sm:justify-between">
          <p className="text-sm text-muted-foreground">
            Built with Next.js, Claude, and ElevenLabs
          </p>
          <a
            href="https://github.com/krleh/pod-faster"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
          >
            <Github className="size-4" />
            GitHub
          </a>
        </div>
      </footer>
    </div>
  );
}
