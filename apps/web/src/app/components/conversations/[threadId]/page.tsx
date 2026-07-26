import { ComponentLoopWorkspace } from "@/components/component-loop-workspace";

export default async function ComponentConversationPage({
  params,
}: {
  params: Promise<{ threadId: string }>;
}) {
  const { threadId } = await params;
  return <ComponentLoopWorkspace initialThreadId={threadId} />;
}
