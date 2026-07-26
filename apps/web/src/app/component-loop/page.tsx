import { redirect } from "next/navigation";

export default async function LegacyComponentLoopPage({
  searchParams,
}: {
  searchParams: Promise<{ thread?: string }>;
}) {
  const { thread } = await searchParams;
  redirect(
    thread
      ? `/components/conversations/${encodeURIComponent(thread)}`
      : "/components/build",
  );
}
