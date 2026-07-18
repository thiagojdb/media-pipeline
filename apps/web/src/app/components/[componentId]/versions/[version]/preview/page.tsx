import { notFound } from "next/navigation";

import { ComponentPreviewWorkspace } from "@/components/component-preview-workspace";
import { hasPreviewComponent } from "@/lib/preview-components";

export default async function ComponentPreviewPage({
  params,
}: {
  params: Promise<{ componentId: string; version: string }>;
}) {
  const { componentId, version } = await params;
  if (!hasPreviewComponent(componentId, version)) notFound();

  return (
    <ComponentPreviewWorkspace componentId={componentId} version={version} />
  );
}
