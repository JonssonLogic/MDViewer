export interface Comment {
  id: string;
  section: string;
  paragraph: number;
  targetText: string;
  contextBefore: string;
  contextAfter: string;
  body: string;
  createdAt: string;
  updatedAt: string;
  orphaned?: boolean;
  /** Resolved character offset in clean content (set by anchorComments) */
  _offset?: number;
}
