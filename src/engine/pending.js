// Pending player decisions (DESIGN.md §4 "Pending choices").
// A pending choice is plain JSON in state.pending; the code that resolves it is looked up by `kind`
// in a module-level handler registry (handlers are functions, so they cannot live in the state).

const handlers = {};

/**
 * Register the resolver for a pending kind. Call at module load time.
 * @param {string} kind
 * @param {(state, pending, optionIndex:number, extra?:any) => {ok:boolean, events?:any[], error?:string}} fn
 */
export function registerPendingHandler(kind, fn) {
  handlers[kind] = fn;
}

/**
 * Queue a decision for a player.
 * @param {object} p { kind, playerId, heroId?, options: [{id?, label, ...}], data? }
 * @returns {object} the stored pending choice (with its generated id)
 */
export function pushPending(state, p) {
  state.pending ??= [];
  state.nextPendingId = (state.nextPendingId || 0) + 1;
  const pending = { id: state.nextPendingId, options: [], data: {}, ...p };
  state.pending.push(pending);
  return pending;
}

export function getPending(state, playerId) {
  return (state.pending || []).filter((p) => playerId === undefined || p.playerId === playerId);
}

export function hasPending(state, playerId) {
  return getPending(state, playerId).length > 0;
}

/**
 * Resolve a pending choice. `extra` carries free-form input for kinds that need more than an
 * option index (e.g. a quantity). The pending entry is removed before its handler runs, so the
 * handler may push follow-up choices.
 */
export function resolvePending(state, id, optionIndex, extra) {
  const idx = (state.pending || []).findIndex((p) => p.id === id);
  if (idx < 0) return { ok: false, error: 'no_such_pending' };
  const pending = state.pending[idx];
  if (pending.options.length > 0 && !(optionIndex >= 0 && optionIndex < pending.options.length)) {
    return { ok: false, error: 'bad_option' };
  }
  const handler = handlers[pending.kind];
  if (!handler) throw new Error(`No pending handler registered for kind '${pending.kind}'`);
  state.pending.splice(idx, 1);
  const res = handler(state, pending, optionIndex, extra) || { ok: true };
  return { ok: res.ok !== false, events: res.events || [], ...(res.error ? { error: res.error } : {}) };
}
