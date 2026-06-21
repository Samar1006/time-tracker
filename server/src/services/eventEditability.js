/** Event types users may edit via drag/resize or voice schedule mutations. */
export const USER_EDITABLE_EVENT_TYPES = new Set(['voice', 'manual']);

/** Browser/extension ingest (`domain_visit`, `app_focus`, etc.) is read-only. */
export function isUserEditableEvent(event) {
  return USER_EDITABLE_EVENT_TYPES.has(event?.type);
}
