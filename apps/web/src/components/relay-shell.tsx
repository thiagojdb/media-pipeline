import { Boxes, LayoutDashboard, Play } from "lucide-react";

type RelayDestination = "projects" | "components";

export function RelayShell({
  active,
  children,
  channelName,
  fluid = false,
}: {
  active: RelayDestination;
  children: React.ReactNode;
  channelName?: string | undefined;
  fluid?: boolean;
}) {
  return (
    <main className="min-h-screen bg-[#f3f5f3] text-[#171b1f]">
      <div className="flex min-h-screen">
        <aside className="sticky top-0 hidden h-screen w-56 shrink-0 flex-col border-r border-[#d8dddb] bg-[#edf0ee] lg:flex">
          <RelayIdentity channelName={channelName} />
          <RelayNavigation active={active} />
          <div className="mt-auto border-t border-[#d8dddb] p-4">
            <p className="font-mono text-[9px] tracking-[0.12em] text-[#7b858c] uppercase">
              Production workspace
            </p>
            <p className="mt-1 text-[11px] leading-4 text-[#68747d]">
              Sources, narration, and every approved cut stay connected.
            </p>
          </div>
        </aside>

        <div className="min-w-0 flex-1">
          <header className="flex h-16 items-center justify-between border-b border-[#d8dddb] bg-[#edf0ee] px-4 lg:hidden">
            <RelayIdentity channelName={channelName} compact />
            <RelayNavigation active={active} compact />
          </header>

          <div
            className={
              fluid ? "min-w-0" : "mx-auto max-w-7xl px-5 py-8 lg:px-8 lg:py-10"
            }
          >
            {children}
          </div>
        </div>
      </div>
    </main>
  );
}

function RelayIdentity({
  channelName,
  compact = false,
}: {
  channelName?: string | undefined;
  compact?: boolean;
}) {
  return (
    <a
      className={
        compact
          ? "flex items-center gap-2.5"
          : "flex h-[4.75rem] items-center gap-3 border-b border-[#d8dddb] px-5"
      }
      href="/projects"
    >
      <div
        className={`relative flex items-center justify-center overflow-hidden rounded-lg bg-[#171b1f] text-white ${
          compact ? "size-8" : "size-9"
        }`}
      >
        <span className="absolute inset-y-1.5 left-1.5 w-0.5 rounded-full bg-[#f45d48]" />
        <Play className="ml-0.5 size-3.5 fill-current" />
      </div>
      <div>
        <strong className="block font-[family-name:var(--font-display)] text-sm tracking-[-0.01em]">
          Relay
        </strong>
        <span
          className={`block truncate text-[#68747d] ${
            compact ? "max-w-44 text-[10px]" : "max-w-32 text-[11px]"
          }`}
        >
          {channelName ?? "Relay Studio"}
        </span>
      </div>
    </a>
  );
}

function RelayNavigation({
  active,
  compact = false,
}: {
  active: RelayDestination;
  compact?: boolean;
}) {
  if (compact)
    return (
      <nav className="flex items-center gap-1" aria-label="Channel">
        <DestinationLink
          active={active === "projects"}
          compact
          href="/projects"
          icon={LayoutDashboard}
          label="Projects"
        />
        <DestinationLink
          active={active === "components"}
          compact
          href="/components"
          icon={Boxes}
          label="Components"
        />
      </nav>
    );

  return (
    <nav className="space-y-1 px-3 py-4 text-sm" aria-label="Channel">
      <DestinationLink
        active={active === "projects"}
        href="/projects"
        icon={LayoutDashboard}
        label="Projects"
      />
      <DestinationLink
        active={active === "components"}
        href="/components"
        icon={Boxes}
        label="Components"
      />
    </nav>
  );
}

function DestinationLink({
  active,
  compact = false,
  href,
  icon: Icon,
  label,
}: {
  active: boolean;
  compact?: boolean;
  href: string;
  icon: typeof Boxes;
  label: string;
}) {
  if (compact)
    return (
      <a
        aria-current={active ? "page" : undefined}
        aria-label={label}
        className={`rounded-md p-2 ${
          active ? "bg-white text-[#355ce8] shadow-sm" : "text-[#68747d]"
        }`}
        href={href}
      >
        <Icon className="size-4" />
      </a>
    );

  return (
    <a
      aria-current={active ? "page" : undefined}
      className={`flex items-center gap-3 rounded-lg px-3 py-2.5 ${
        active
          ? "bg-white font-medium text-[#171b1f] shadow-sm"
          : "text-[#68747d] hover:bg-white/70 hover:text-[#171b1f]"
      }`}
      href={href}
    >
      <Icon className={`size-4 ${active ? "text-[#355ce8]" : ""}`} />
      {label}
    </a>
  );
}
