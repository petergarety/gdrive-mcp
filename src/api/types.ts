/**
 * Minimal Google Docs element types.
 * These cover the shapes we actually touch — not the full Docs API surface.
 */

export type NamedStyleType =
  | 'TITLE'
  | 'SUBTITLE'
  | 'HEADING_1'
  | 'HEADING_2'
  | 'HEADING_3'
  | 'HEADING_4'
  | 'HEADING_5'
  | 'HEADING_6'
  | 'NORMAL_TEXT'
  | string; // Google may add others; treat unknown as plain.

export interface TextRun {
  content?: string;
}

export interface ParagraphElement {
  textRun?: TextRun;
}

export interface ParagraphStyle {
  namedStyleType?: NamedStyleType;
  headingId?: string;
}

export interface Paragraph {
  elements?: ParagraphElement[];
  paragraphStyle?: ParagraphStyle;
}

export interface TableCell {
  content?: StructuralElement[];
}

export interface TableRow {
  tableCells?: TableCell[];
}

export interface Table {
  tableRows?: TableRow[];
}

export interface StructuralElement {
  startIndex?: number;
  endIndex?: number;
  paragraph?: Paragraph;
  table?: Table;
}

export interface DocumentTab {
  tabId?: string;
  title?: string;
  tabProperties?: { title?: string };
  documentTab?: {
    body?: { content?: StructuralElement[] };
  };
}

export interface Heading {
  level: number;
  text: string;
  index: number;
  id?: string;
}
