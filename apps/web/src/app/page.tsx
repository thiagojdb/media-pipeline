import { ArrowUpRight } from "lucide-react";

import { Button } from "@/components/ui/button";

const foundationBoundaries = [
  "Next.js creator application",
  "Convex application control plane",
  "Node build and render worker",
  "Shared component and rendering packages",
] as const;

export default function Home() {
  return (
    <main className="mx-auto flex min-h-screen max-w-5xl flex-col justify-center px-6 py-20">
      <p className="text-muted-foreground mb-4 text-sm font-medium tracking-widest uppercase">
        Relay foundation
      </p>
      <h1 className="max-w-3xl text-5xl leading-tight font-semibold tracking-tight sm:text-7xl">
        Production workspace for source-based video.
      </h1>
      <p className="text-muted-foreground mt-6 max-w-2xl text-lg leading-8">
        This scaffold establishes the runtime boundaries for the component
        authoring loop. Product workflows arrive in their dedicated issues.
      </p>

      <ul className="mt-12 grid gap-3 sm:grid-cols-2">
        {foundationBoundaries.map((boundary) => (
          <li key={boundary} className="rounded-lg border bg-white p-5 text-sm">
            {boundary}
          </li>
        ))}
      </ul>

      <div className="mt-10 flex flex-wrap gap-3">
        <Button asChild>
          <a href="/components/animated-line-chart/versions/1.0.0/preview">
            Preview the line chart
            <ArrowUpRight aria-hidden="true" />
          </a>
        </Button>
        <Button asChild variant="outline">
          <a
            href="https://linear.app/media-pipeline/issue/MED-129/build-component-preview-fixtures-and-frame-scrubbing"
            rel="noreferrer"
            target="_blank"
          >
            View preview scope
            <ArrowUpRight aria-hidden="true" />
          </a>
        </Button>
      </div>
    </main>
  );
}
