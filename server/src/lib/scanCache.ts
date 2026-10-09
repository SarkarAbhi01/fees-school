// Native Map duplicate-scan blocker (60 sec). No node-cache / Redis.
const scanMap = new Map<string, true>();

export function isDuplicate(uid: string): boolean {
  if (scanMap.has(uid)) return true;
  scanMap.set(uid, true);
  setTimeout(() => scanMap.delete(uid), 60000);
  return false;
}
