export type CompositionAuthoringImplementation = {
  provider: string;
  model: string;
};

/**
 * Resolve the server-configured composition authoring implementation.
 *
 * Composition proposal mutations run in Convex and must never infer a
 * provider from a test fixture or from browser input. The deployment supplies
 * the implementation identity; tests set the same server-only configuration
 * to their injected editor.
 */
export function configuredCompositionAuthoring(): CompositionAuthoringImplementation {
  const provider = process.env.COMPOSITION_AUTHORING_PROVIDER?.trim();
  const model = process.env.COMPOSITION_AUTHORING_MODEL?.trim();
  if (!provider || !model) {
    throw new Error(
      "Composition authoring requires COMPOSITION_AUTHORING_PROVIDER and COMPOSITION_AUTHORING_MODEL.",
    );
  }
  return { provider, model };
}
