// Bundle only the Markdown grammar used by vault history and an Obsidian CSS theme.
import { createBundledHighlighter, createSingletonShorthands } from "shiki/core";
import { createJavaScriptRegexEngine } from "shiki/engine/javascript";

export * from "shiki/core";
export { createJavaScriptRegexEngine } from "shiki/engine/javascript";
export { createOnigurumaEngine } from "shiki/engine/oniguruma";

export const bundledLanguages = {
  markdown: () => import("shiki/langs/markdown.mjs"),
};
export const createHighlighter = createBundledHighlighter({
  langs: bundledLanguages,
  themes: {},
  engine: () => createJavaScriptRegexEngine(),
});
export const { codeToHtml } = createSingletonShorthands(createHighlighter);
