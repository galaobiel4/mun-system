export function mergePresence(previous, update) {
  const fresh = Number.isFinite(update.presenceAt) && update.presenceAt >= (previous?.presenceAt || 0);
  const source = fresh ? update : previous;
  return { activeEditors: source?.activeEditors || 0, presenceAt: source?.presenceAt || 0, presenceLastSeen: source?.presenceLastSeen || null };
}
