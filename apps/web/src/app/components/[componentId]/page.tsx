import { ComponentLibraryDetail } from "@/components/component-library-workspace";

export default async function ComponentPage({
  params,
}: {
  params: Promise<{ componentId: string }>;
}) {
  const { componentId } = await params;
  return <ComponentLibraryDetail componentId={componentId} />;
}
