/**
 * Text for a Monaco hover, which renders Markdown: every special character
 * is escaped so a comment shows exactly as typed, never as a link, HTML or
 * formatting (AGENTS.md §9). Pure.
 */
export const plainMarkdown = (s: string) =>
  s.replace(/[\\`*_{}[\]()#+\-.!|<>~]/g, '\\$&').replace(/\n/g, '  \n');
