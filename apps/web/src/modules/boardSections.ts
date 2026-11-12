import type { BoardSummary, Workspace } from '@suboard/shared';

export interface BoardSection {
  id: string;
  name: string;
  boards: BoardSummary[];
}

/**
 * Splits a list of boards into sections: each workspace (boards outside any folder), then each of
 * its folders as "workspace › folder", and last the boards that belong to no workspace the viewer
 * knows. Empty sections are dropped.
 */
export function boardSections(boards: BoardSummary[], workspaces: Workspace[], restName: string): BoardSection[] {
  const known = new Set(workspaces.map((w) => w.id));
  const sections: BoardSection[] = [];
  for (const w of workspaces) {
    const mine = boards.filter((b) => b.workspaceId === w.id);
    const folderIds = new Set(w.folders.map((f) => f.id));
    sections.push({ id: w.id, name: w.name, boards: mine.filter((b) => !b.folderId || !folderIds.has(b.folderId)) });
    for (const f of w.folders) sections.push({ id: `${w.id}-${f.id}`, name: `${w.name} › ${f.name}`, boards: mine.filter((b) => b.folderId === f.id) });
  }
  sections.push({ id: 'none', name: restName, boards: boards.filter((b) => !b.workspaceId || !known.has(b.workspaceId)) });
  return sections.filter((s) => s.boards.length > 0);
}
