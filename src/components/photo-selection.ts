export function addPhotoSelection(current: ReadonlySet<string>, id: string): Set<string> {
  if (current.has(id)) return new Set(current);
  const next = new Set(current);
  next.add(id);
  return next;
}

export function togglePhotoSelection(current: ReadonlySet<string>, id: string): Set<string> {
  const next = new Set(current);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  return next;
}

export function replacePhotoSelection(ids: Iterable<string>): Set<string> {
  return new Set(ids);
}
