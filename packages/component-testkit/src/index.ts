import ts from "typescript";

export type SourcePolicyIssueCode =
  | "ambient_environment"
  | "ambient_network"
  | "ambient_randomness"
  | "browser_dimensions"
  | "hidden_renderer_api"
  | "wall_clock";

export interface SourcePolicyIssue {
  readonly code: SourcePolicyIssueCode;
  readonly file: string;
  readonly line: number;
  readonly message: string;
}

export type SourcePolicyResult =
  | { readonly success: true }
  | { readonly success: false; readonly issues: readonly SourcePolicyIssue[] };

type Namespace =
  | "Date"
  | "Math"
  | "crypto"
  | "document"
  | "globalThis"
  | "performance"
  | "process"
  | "screen"
  | "window";

const messages: Readonly<Record<SourcePolicyIssueCode, string>> = {
  ambient_environment:
    "Component source cannot read process.env or ambient environment state.",
  ambient_network:
    "Declare assets and consume resolved asset props; components cannot access the network.",
  ambient_randomness:
    "Do not use ambient randomness; use stable input data and frame-derived calculations.",
  browser_dimensions:
    "Use the width and height supplied in component props instead of browser dimensions.",
  hidden_renderer_api:
    "Use only the frame, timing, and dimensions supplied in component props.",
  wall_clock:
    "Derive timing from the frame context; wall-clock time is not deterministic.",
};

const namespaces = new Set<Namespace>([
  "Date",
  "Math",
  "crypto",
  "document",
  "globalThis",
  "performance",
  "process",
  "screen",
  "window",
]);

/**
 * Performs the syntax-aware deterministic source-policy check used for
 * component candidates. This is validation evidence, not a security sandbox;
 * the worker must still enforce dependency, process, and network policy.
 */
export function validateComponentSource(
  files: Readonly<Record<string, string>>,
): SourcePolicyResult {
  const issues: SourcePolicyIssue[] = [];

  for (const [file, source] of Object.entries(files).sort(([left], [right]) =>
    left.localeCompare(right),
  )) {
    const sourceFile = ts.createSourceFile(
      file,
      source,
      ts.ScriptTarget.Latest,
      true,
      scriptKind(file),
    );
    validateSourceFile(sourceFile, file, issues);
  }

  return issues.length === 0 ? { success: true } : { success: false, issues };
}

function validateSourceFile(
  sourceFile: ts.SourceFile,
  file: string,
  issues: SourcePolicyIssue[],
): void {
  const capabilityAliases = new Map<string, SourcePolicyIssueCode>();
  const namespaceAliases = new Map<string, Namespace>();

  const report = (node: ts.Node, code: SourcePolicyIssueCode): void => {
    const line =
      sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line +
      1;
    if (
      issues.some(
        (issue) =>
          issue.file === file && issue.line === line && issue.code === code,
      )
    )
      return;
    issues.push({ code, file, line, message: messages[code] });
  };

  const resolvedPropertyChain = (
    expression: ts.Expression,
  ): readonly string[] | undefined => {
    const chain = propertyChain(expression);
    if (!chain?.[0]) return chain;
    const aliasedNamespace = namespaceAliases.get(chain[0]);
    return aliasedNamespace ? [aliasedNamespace, ...chain.slice(1)] : chain;
  };

  const namespaceOf = (expression: ts.Expression): Namespace | undefined => {
    expression = unwrap(expression);
    if (ts.isIdentifier(expression)) {
      if (namespaces.has(expression.text as Namespace))
        return expression.text as Namespace;
      return namespaceAliases.get(expression.text);
    }

    const chain = normalizedGlobalChain(resolvedPropertyChain(expression));
    if (chain?.length === 1 && namespaces.has(chain[0] as Namespace)) {
      return chain[0] as Namespace;
    }
    return undefined;
  };

  const rootNamespaceOf = (
    expression: ts.Expression,
  ): Namespace | undefined => {
    const chain = propertyChain(expression);
    if (!chain?.[0]) return undefined;
    if (namespaces.has(chain[0] as Namespace)) return chain[0] as Namespace;
    return namespaceAliases.get(chain[0]);
  };

  const propertyCapability = (
    namespace: Namespace | undefined,
    property: string,
    fullChain?: readonly string[],
  ): SourcePolicyIssueCode | undefined => {
    if (namespace === "Date" && property === "now") return "wall_clock";
    if (namespace === "performance" && property === "now") return "wall_clock";
    if (namespace === "Math" && property === "random")
      return "ambient_randomness";
    if (
      namespace === "crypto" &&
      (property === "getRandomValues" || property === "randomUUID")
    ) {
      return "ambient_randomness";
    }
    if (
      (namespace === "globalThis" || namespace === "window") &&
      isNetworkName(property)
    ) {
      return "ambient_network";
    }
    if (namespace === "process" && property === "env")
      return "ambient_environment";
    if (namespace === "window" && isBrowserDimension(property))
      return "browser_dimensions";
    if (
      namespace === "screen" &&
      (property === "width" || property === "height")
    ) {
      return "browser_dimensions";
    }
    if (
      namespace === "document" &&
      fullChain?.slice(-2).join(".") === "documentElement.clientWidth"
    ) {
      return "browser_dimensions";
    }
    if (
      namespace === "document" &&
      fullChain?.slice(-2).join(".") === "documentElement.clientHeight"
    ) {
      return "browser_dimensions";
    }
    return undefined;
  };

  const classify = (
    expression: ts.Expression,
  ): SourcePolicyIssueCode | undefined => {
    expression = unwrap(expression);
    if (ts.isIdentifier(expression)) {
      const alias = capabilityAliases.get(expression.text);
      if (alias) return alias;
      if (expression.text === "Date") return "wall_clock";
      if (isNetworkName(expression.text)) return "ambient_network";
      if (isBrowserDimension(expression.text)) return "browser_dimensions";
      if (isRendererApi(expression.text)) return "hidden_renderer_api";
      return undefined;
    }
    if (
      ts.isPropertyAccessExpression(expression) ||
      ts.isElementAccessExpression(expression)
    ) {
      const chain = normalizedGlobalChain(resolvedPropertyChain(expression));
      const chainCapability = chain && classifyGlobalChain(chain);
      if (chainCapability) return chainCapability;

      const property = propertyName(expression);
      if (!property) return undefined;
      return propertyCapability(
        namespaceOf(expression.expression) ??
          rootNamespaceOf(expression.expression),
        property,
        propertyChain(expression),
      );
    }
    return undefined;
  };

  const rememberDeclaration = (declaration: ts.VariableDeclaration): void => {
    if (!declaration.initializer) return;
    const initializer = unwrap(declaration.initializer);
    if (ts.isIdentifier(declaration.name)) {
      const namespace = namespaceOf(initializer);
      if (namespace) namespaceAliases.set(declaration.name.text, namespace);
      const capability = classify(initializer);
      if (capability) capabilityAliases.set(declaration.name.text, capability);
      return;
    }
    if (!ts.isObjectBindingPattern(declaration.name)) return;
    const namespace = namespaceOf(initializer);
    for (const element of declaration.name.elements) {
      if (!ts.isIdentifier(element.name)) continue;
      const property = stripQuotes(
        element.propertyName?.getText(sourceFile) ?? element.name.text,
      );
      const nestedNamespace = globalPropertyNamespace(namespace, property);
      if (nestedNamespace)
        namespaceAliases.set(element.name.text, nestedNamespace);
      const capability = propertyCapability(namespace, property);
      if (capability) capabilityAliases.set(element.name.text, capability);
    }
  };

  const rememberAssignment = (
    target: ts.Expression,
    value: ts.Expression,
  ): void => {
    const namespace = namespaceOf(value);
    if (ts.isIdentifier(target)) {
      capabilityAliases.delete(target.text);
      namespaceAliases.delete(target.text);
      if (namespace) namespaceAliases.set(target.text, namespace);
      const capability = classify(value);
      if (capability) capabilityAliases.set(target.text, capability);
      return;
    }
    if (!ts.isObjectLiteralExpression(target)) return;
    for (const property of target.properties) {
      if (
        !ts.isShorthandPropertyAssignment(property) &&
        !ts.isPropertyAssignment(property)
      )
        continue;
      const sourceName = propertyNameFromNode(property.name);
      const targetName = assignmentTargetName(property);
      if (!sourceName || !targetName) continue;
      capabilityAliases.delete(targetName);
      namespaceAliases.delete(targetName);
      const nestedNamespace = globalPropertyNamespace(namespace, sourceName);
      if (nestedNamespace) namespaceAliases.set(targetName, nestedNamespace);
      const capability = propertyCapability(namespace, sourceName);
      if (capability) capabilityAliases.set(targetName, capability);
    }
  };

  const visit = (node: ts.Node): void => {
    if (isRemotionModuleDeclaration(node)) {
      report(node, "hidden_renderer_api");
      return;
    }

    if (ts.isVariableDeclaration(node)) rememberDeclaration(node);
    if (
      ts.isBinaryExpression(node) &&
      node.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
      (ts.isIdentifier(node.left) || ts.isObjectLiteralExpression(node.left))
    ) {
      rememberAssignment(node.left, node.right);
    }

    if (ts.isCallExpression(node) || ts.isNewExpression(node)) {
      if (ts.isCallExpression(node) && isRemotionLoader(node)) {
        report(node, "hidden_renderer_api");
        return;
      }
      const capability = classify(node.expression);
      if (capability) {
        report(node, capability);
        return;
      }
    }
    if (
      ts.isPropertyAccessExpression(node) ||
      ts.isElementAccessExpression(node)
    ) {
      const capability = classify(node);
      if (capability) {
        report(node, capability);
        return;
      }
    }
    if (
      ts.isIdentifier(node) &&
      isBrowserDimension(node.text) &&
      isValueReferenceIdentifier(node)
    ) {
      report(node, "browser_dimensions");
      return;
    }

    ts.forEachChild(node, visit);
  };

  visit(sourceFile);
}

function unwrap(expression: ts.Expression): ts.Expression {
  while (
    ts.isParenthesizedExpression(expression) ||
    ts.isAsExpression(expression) ||
    ts.isTypeAssertionExpression(expression) ||
    ts.isNonNullExpression(expression)
  ) {
    expression = expression.expression;
  }
  return expression;
}

function propertyName(
  expression: ts.PropertyAccessExpression | ts.ElementAccessExpression,
): string | undefined {
  if (ts.isPropertyAccessExpression(expression)) return expression.name.text;
  const argument = expression.argumentExpression;
  return argument &&
    (ts.isStringLiteral(argument) ||
      ts.isNoSubstitutionTemplateLiteral(argument))
    ? argument.text
    : undefined;
}

function propertyChain(
  expression: ts.Expression,
): readonly string[] | undefined {
  expression = unwrap(expression);
  if (ts.isIdentifier(expression)) return [expression.text];
  if (
    !ts.isPropertyAccessExpression(expression) &&
    !ts.isElementAccessExpression(expression)
  )
    return undefined;
  const parent = propertyChain(expression.expression);
  const property = propertyName(expression);
  return parent && property ? [...parent, property] : undefined;
}

function normalizedGlobalChain(
  chain: readonly string[] | undefined,
): readonly string[] | undefined {
  if (!chain || chain.length < 2) return chain;
  return chain[0] === "globalThis" || chain[0] === "window"
    ? chain.slice(1)
    : chain;
}

function classifyGlobalChain(
  chain: readonly string[],
): SourcePolicyIssueCode | undefined {
  const [root, property] = chain;
  if (!root) return undefined;
  if (root === "Date" && (chain.length === 1 || property === "now"))
    return "wall_clock";
  if (root === "performance" && property === "now") return "wall_clock";
  if (root === "Math" && property === "random") return "ambient_randomness";
  if (
    root === "crypto" &&
    (property === "getRandomValues" || property === "randomUUID")
  )
    return "ambient_randomness";
  if (root === "process" && property === "env") return "ambient_environment";
  if (isNetworkName(root)) return "ambient_network";
  if (isBrowserDimension(root)) return "browser_dimensions";
  if (isRendererApi(root)) return "hidden_renderer_api";
  if (root === "screen" && (property === "width" || property === "height"))
    return "browser_dimensions";
  if (
    root === "document" &&
    chain.slice(-2).join(".") === "documentElement.clientWidth"
  )
    return "browser_dimensions";
  if (
    root === "document" &&
    chain.slice(-2).join(".") === "documentElement.clientHeight"
  )
    return "browser_dimensions";
  return undefined;
}

function globalPropertyNamespace(
  namespace: Namespace | undefined,
  property: string,
): Namespace | undefined {
  return (namespace === "globalThis" || namespace === "window") &&
    namespaces.has(property as Namespace)
    ? (property as Namespace)
    : undefined;
}

function propertyNameFromNode(node: ts.PropertyName): string | undefined {
  return ts.isIdentifier(node) ||
    ts.isStringLiteral(node) ||
    ts.isNumericLiteral(node)
    ? node.text
    : undefined;
}

function assignmentTargetName(
  property: ts.ObjectLiteralElementLike,
): string | undefined {
  if (ts.isShorthandPropertyAssignment(property)) return property.name.text;
  if (
    ts.isPropertyAssignment(property) &&
    ts.isIdentifier(property.initializer)
  )
    return property.initializer.text;
  return undefined;
}

function isRendererApi(name: string): boolean {
  return (
    name === "useCurrentFrame" ||
    name === "useVideoConfig" ||
    name === "getRemotionEnvironment"
  );
}

function isRemotionModuleDeclaration(node: ts.Node): boolean {
  if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) {
    return Boolean(
      node.moduleSpecifier && isRemotionSpecifier(node.moduleSpecifier),
    );
  }
  if (
    ts.isImportEqualsDeclaration(node) &&
    ts.isExternalModuleReference(node.moduleReference)
  ) {
    const specifier = node.moduleReference.expression;
    return Boolean(specifier && isRemotionSpecifier(specifier));
  }
  return false;
}

function isRemotionSpecifier(node: ts.Expression): boolean {
  return (
    (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) &&
    isRemotionModule(node.text)
  );
}

function isRemotionLoader(node: ts.CallExpression): boolean {
  const isDynamicImport = node.expression.kind === ts.SyntaxKind.ImportKeyword;
  const isRequire =
    ts.isIdentifier(node.expression) && node.expression.text === "require";
  if (!isDynamicImport && !isRequire) return false;
  const [specifier] = node.arguments;
  return Boolean(specifier && isRemotionSpecifier(specifier));
}

function isRemotionModule(value: string): boolean {
  return value === "remotion" || value.startsWith("remotion/");
}

function isNetworkName(name: string): boolean {
  return (
    name === "fetch" ||
    name === "XMLHttpRequest" ||
    name === "WebSocket" ||
    name === "EventSource"
  );
}

function isBrowserDimension(name: string): boolean {
  return (
    name === "innerWidth" ||
    name === "innerHeight" ||
    name === "outerWidth" ||
    name === "outerHeight"
  );
}

function isValueReferenceIdentifier(node: ts.Identifier): boolean {
  const parent = node.parent;
  if (ts.isPropertyAccessExpression(parent) && parent.name === node)
    return false;
  if (ts.isPropertyAssignment(parent) && parent.name === node) return false;
  if (ts.isPropertyDeclaration(parent) && parent.name === node) return false;
  if (ts.isVariableDeclaration(parent) && parent.name === node) return false;
  if (ts.isBindingElement(parent) && parent.name === node) return false;
  if (ts.isParameter(parent) && parent.name === node) return false;
  return true;
}

function stripQuotes(value: string): string {
  return value.replace(/^(?:["'])(.*)(?:["'])$/, "$1");
}

function scriptKind(file: string): ts.ScriptKind {
  if (file.endsWith(".tsx")) return ts.ScriptKind.TSX;
  if (file.endsWith(".jsx")) return ts.ScriptKind.JSX;
  if (file.endsWith(".js") || file.endsWith(".mjs") || file.endsWith(".cjs"))
    return ts.ScriptKind.JS;
  return ts.ScriptKind.TS;
}
