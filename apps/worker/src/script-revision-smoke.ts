import { createScriptRevisionAgentFromEnvironment } from "./script-revision-agent.js";

if (process.env.SCRIPT_REVISION_SMOKE_CONFIRM !== "spend-model-tokens") {
  throw new Error(
    "Refusing paid script revision smoke. Set SCRIPT_REVISION_SMOKE_CONFIRM=spend-model-tokens explicitly.",
  );
}

const agent = createScriptRevisionAgentFromEnvironment();
const selected = agent
  .listModels()
  .find(
    (model) =>
      model.provider === process.env.SCRIPT_REVISION_PROVIDER &&
      model.model === process.env.SCRIPT_REVISION_MODEL,
  );
const fallback = agent.listModels().find((model) => model.default);
const model = selected ?? fallback;
if (!model) throw new Error("No script revision model is configured.");

const result = await agent.generate({
  instruction:
    "Make this opening more vivid and concise without changing its meaning.",
  scope: "selection",
  sourceMarkdown:
    "The city was quiet before sunrise, and the investigation was about to begin.",
  provider: model.provider,
  model: model.model,
});

console.log(
  JSON.stringify(
    {
      provider: result.provider,
      model: result.model,
      replacementMarkdown: result.replacementMarkdown,
      inputTokens: result.inputTokens,
      outputTokens: result.outputTokens,
      wallTimeMs: result.wallTimeMs,
    },
    null,
    2,
  ),
);
