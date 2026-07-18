export default function ComponentPreviewNotFound() {
  return (
    <main className="mx-auto max-w-2xl px-6 py-24">
      <p className="text-sm font-semibold tracking-widest uppercase">
        Not found
      </p>
      <h1 className="mt-3 text-3xl font-semibold">
        Component version unavailable
      </h1>
      <p className="text-muted-foreground mt-3">
        Preview requires an exact component identity and version.
      </p>
    </main>
  );
}
