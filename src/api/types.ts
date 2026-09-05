/** Minimal typed subset of Google Docs; unknown fields remain available for safety checks. */
export type NamedStyleType = 'TITLE' | 'SUBTITLE' | 'NORMAL_TEXT' | string;
export interface TextRun { content?: string; [key: string]: unknown }
export interface ParagraphElement {
  startIndex?: number;
  endIndex?: number;
  textRun?: TextRun;
  [key: string]: unknown;
}
export interface ParagraphStyle {
  namedStyleType?: NamedStyleType;
  headingId?: string;
  [key: string]: unknown;
}
export interface Paragraph {
  elements?: ParagraphElement[];
  paragraphStyle?: ParagraphStyle;
  positionedObjectIds?: string[];
  [key: string]: unknown;
}
export interface TableCell { content?: StructuralElement[] }
export interface TableRow { tableCells?: TableCell[] }
export interface Table { tableRows?: TableRow[] }
export interface StructuralElement {
  startIndex?: number;
  endIndex?: number;
  paragraph?: Paragraph;
  table?: Table;
  tableOfContents?: { content?: StructuralElement[] };
  [key: string]: unknown;
}
export interface DocumentTab {
  tabProperties?: { tabId?: string; title?: string; index?: number; parentTabId?: string };
  childTabs?: DocumentTab[];
  documentTab?: { body?: { content?: StructuralElement[] }; [key: string]: unknown };
  [key: string]: unknown;
}
export interface Heading {
  level: number;
  text: string;
  index: number;
  endIndex?: number;
  id?: string;
  tabId?: string;
  tabTitle?: string;
  inTable?: boolean;
}
