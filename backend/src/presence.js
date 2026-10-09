export const PRESENCE_TTL = 90000;
export function activeEditors(sockets, now = Date.now(), exclude) {
  return sockets.filter(socket => {
    const seen = socket.deserializeAttachment()?.lastSeen;
    return socket !== exclude && socket.readyState === 1 && Number.isFinite(seen) && now - seen < PRESENCE_TTL;
  });
}
