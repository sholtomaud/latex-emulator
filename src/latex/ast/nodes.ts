import type { Range } from '../source.ts';

/** An argument of a command or environment, e.g. the `{Title}` of \section. */
export interface ArgNode {
  kind: 'arg';
  optional: boolean;
  children: Node[];
  /** Includes the delimiters; zero-length for an unbraced single token. */
  range: Range;
}

export interface TextNode {
  kind: 'text';
  value: string;
  range: Range;
}

export interface SpaceNode {
  kind: 'space';
  range: Range;
}

export interface ParbreakNode {
  kind: 'parbreak';
  range: Range;
}

export interface CommentNode {
  kind: 'comment';
  value: string;
  range: Range;
}

/** & # ^ _ ~ */
export interface SpecialNode {
  kind: 'special';
  char: string;
  range: Range;
}

export interface CommandNode {
  kind: 'command';
  name: string;
  star: boolean;
  args: ArgNode[];
  /** The `\name` (and `*`) only. */
  nameRange: Range;
  range: Range;
}

export interface GroupNode {
  kind: 'group';
  children: Node[];
  range: Range;
}

export interface EnvironmentNode {
  kind: 'environment';
  name: string;
  args: ArgNode[];
  children: Node[];
  /** Body parsed in math mode (equation, align, …). */
  mathMode: boolean;
  range: Range;
}

export interface MathNode {
  kind: 'math';
  display: boolean;
  delimiter: '$' | '$$' | '\\(' | '\\[';
  children: Node[];
  /** Raw TeX between the delimiters. */
  source: string;
  range: Range;
}

export interface VerbNode {
  kind: 'verb';
  value: string;
  star: boolean;
  range: Range;
}

export interface VerbatimNode {
  kind: 'verbatim';
  value: string;
  env: string;
  range: Range;
}

export type Node =
  | TextNode
  | SpaceNode
  | ParbreakNode
  | CommentNode
  | SpecialNode
  | CommandNode
  | GroupNode
  | EnvironmentNode
  | MathNode
  | VerbNode
  | VerbatimNode;

export interface RootNode {
  kind: 'root';
  children: Node[];
  range: Range;
}
