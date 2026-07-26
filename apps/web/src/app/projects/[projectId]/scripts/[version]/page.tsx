import { ProjectScriptVersionWorkspace } from "@/components/project-workspace";

export default async function ScriptVersionPage({
  params,
}: {
  params: Promise<{ projectId: string; version: string }>;
}) {
  const { projectId, version } = await params;
  return (
    <ProjectScriptVersionWorkspace
      projectId={projectId}
      version={Number(version)}
    />
  );
}
