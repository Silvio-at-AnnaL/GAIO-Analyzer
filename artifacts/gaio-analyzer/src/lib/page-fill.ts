/** Filling is opt-in and only available for an incomplete editable selection. */
export function canFillPages(editablePages: string[], selectedPages: string[]): boolean {
  return editablePages.length > 0 && selectedPages.length > 0 && selectedPages.length < 16;
}

export function pageFillOptions(editablePages: string[], selectedPages: string[], checked: boolean):
  { fillToMax?: true; excludedUrls?: string[] } {
  if (!checked || !canFillPages(editablePages, selectedPages)) return {};
  const selected = new Set(selectedPages);
  return { fillToMax: true, excludedUrls: editablePages.filter((url) => !selected.has(url)) };
}
