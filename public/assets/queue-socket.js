import { auth } from './api.js';

/**
 * One websocket connection for the whole app, reused across screens.
 *
 * Opening a socket per screen would leave the previous one lingering while the
 * next handshakes, and the server would broadcast to both. A single connection
 * that changes which shop it watches is simpler to reason about and cheaper on
 * a free tier.
 */
let socket = null;
let watching = null;
const handlers = new Set();
const log = [];

function ensureSocket() {
  if (socket?.connected || socket?.active) return socket;

  // io() comes from the server's own bundle at /socket.io/socket.io.js, so the
  // app needs no CDN.
  socket = window.io('/queue', { auth: { token: auth.token }, transports: ['websocket'] });

  socket.on('queue.updated', (payload) => {
    record(`queue.updated · ${payload.entries.length} booking · ${payload.date}`);
    handlers.forEach((fn) => fn(payload));
  });
  socket.on('connect', () => record('websocket tersambung'));
  socket.on('disconnect', () => record('websocket terputus'));
  socket.on('connect_error', (error) => record(`ditolak: ${error.message}`));

  return socket;
}

function record(text) {
  log.unshift({ at: new Date().toLocaleTimeString('id-ID'), text });
  log.length = Math.min(log.length, 40);
}

export const events = () => log;

/** Subscribes to a shop's queue for one date. Returns an unsubscribe function. */
export function watchQueue(shopId, date, handler) {
  const live = ensureSocket();
  handlers.add(handler);

  const join = () => {
    live.emit('queue.watch', { shopId, date });
    watching = { shopId, date };
  };

  if (live.connected) join();
  else live.once('connect', join);

  return () => {
    handlers.delete(handler);
    if (handlers.size === 0 && watching) {
      live.emit('queue.unwatch', { shopId: watching.shopId });
      watching = null;
    }
  };
}

/** Drops the connection so the next one authenticates as whoever signs in next. */
export function closeSocket() {
  socket?.disconnect();
  socket = null;
  watching = null;
  handlers.clear();
}
