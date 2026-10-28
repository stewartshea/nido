// Fired by the response interceptor in api/client.ts after every successful
// non-GET, non-/auth request, so badges and reminder banners refresh the
// moment a mutation lands (commit 7001cdc). Listeners: notificationCount and
// the reminders store. There is no announce helper — the
// interceptor dispatches the Event directly.
export const DATA_CHANGED = 'nido:data-changed';
