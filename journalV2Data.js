/**
 * journalV2Data.js — Journal v2 Data Layer
 * EdgeBook
 *
 * Owns all Firestore read/write for Journal entries (day reflections,
 * AI summaries, period summaries). Each entry is its own Firestore
 * document, following the same per-document architecture as accounts.js.
 *
 * Firestore path:
 *   users/{uid}/journalV2/{entryId}
 *
 * Entry ID conventions:
 *   Day entry:    'day_{account}_{date}'        e.g. 'day_live_2026-06-29'
 *   Week entry:   'week_{account}_{year}-W{ww}' e.g. 'week_live_2026-W26'
 *   Month entry:  'month_{account}_{year}-{mm}' e.g. 'month_live_2026-06'
 *   Year entry:   'year_{account}_{year}'       e.g. 'year_live_2026'
 *
 * Depends on globals from accounts.js (loaded before this file):
 *   _db            — Firestore instance
 *   _currentUser   — current Firebase Auth user (or null)
 *   activeAccount  — 'live' | 'demo'
 *
 * Load order:
 *   <script src="accounts.js"></script>
 *   <script src="journalV2Data.js"></script>   ← this file
 *   <script src="journalV2.js"></script>
 *
 * Public API (window.*):
 *   saveJournalEntry(entry)              — upsert one entry to Firestore
 *   loadJournalEntry(id)                 — load one entry by ID (or null)
 *   loadJournalEntriesForMonth(year, month) — load all day entries for a month
 *   loadJournalPeriodEntry(type, identifier) — load week/month/year entry
 *   deleteJournalEntry(id)               — delete one entry
 *   buildDayEntryId(date)                — 'day_{account}_{date}'
 *   buildPeriodEntryId(type, identifier) — 'week/month/year_{account}_{id}'
 */

// ─── FIRESTORE COLLECTION REF ──────────────────────────────
function _journalCol() {
  // Mirror of _tradesCol() in accounts.js — same user, different sub-collection.
  // _db and _currentUser are declared in accounts.js and available globally.
  return _db
    .collection('users')
    .doc(_currentUser.uid)
    .collection('journalV2');
}

// ─── ID BUILDERS ───────────────────────────────────────────
// Deterministic IDs so loading and saving always refer to the same document
// for the same (account, date/period) combination.

function buildDayEntryId(date) {
  // date: 'YYYY-MM-DD' string
  return `day_${activeAccount}_${date}`;
}

function buildPeriodEntryId(type, identifier) {
  // type:       'week' | 'month' | 'year'
  // identifier: '2026-W26' | '2026-06' | '2026'
  return `${type}_${activeAccount}_${identifier}`;
}

// ─── SAVE ──────────────────────────────────────────────────
async function saveJournalEntry(entry) {
  if (!_currentUser) return;
  try {
    const ref = _journalCol().doc(entry.id);
    await ref.set({
      ...entry,
      account: activeAccount,
      updatedAt: firebase.firestore.FieldValue.serverTimestamp()
    }, { merge: true }); // merge: true so partial updates don't wipe fields
  } catch (e) {
    console.error('saveJournalEntry error:', e);
    throw e;
  }
}

// ─── LOAD SINGLE ───────────────────────────────────────────
async function loadJournalEntry(id) {
  if (!_currentUser) return null;
  try {
    const snap = await _journalCol().doc(id).get();
    return snap.exists ? snap.data() : null;
  } catch (e) {
    console.error('loadJournalEntry error:', e);
    return null;
  }
}

// ─── LOAD MONTH ────────────────────────────────────────────
// Returns all day entries for the given year+month, sorted by date ascending.
// Only loads entries for the current activeAccount.
async function loadJournalEntriesForMonth(year, month) {
  if (!_currentUser) return [];
  try {
    // Day entry IDs for a month are 'day_{account}_YYYY-MM-DD'.
    // Use a prefix range query: >= 'day_{account}_{YYYY-MM}-01'
    //                           <  'day_{account}_{YYYY-MM}-32' (safe upper bound)
    const pad   = String(month).padStart(2, '0');
    const prefix = `day_${activeAccount}_${year}-${pad}-`;
    const snap  = await _journalCol()
      .where('account', '==', activeAccount)
      .where(firebase.firestore.FieldPath.documentId(), '>=', prefix + '01')
      .where(firebase.firestore.FieldPath.documentId(), '<=', prefix + '31')
      .get();
    if (snap.empty) return [];
    return snap.docs
      .map(doc => doc.data())
      .sort((a, b) => String(a.date).localeCompare(String(b.date)));
  } catch (e) {
    console.error('loadJournalEntriesForMonth error:', e);
    return [];
  }
}

// ─── LOAD PERIOD ENTRY ─────────────────────────────────────
// Convenience wrapper — builds the ID and calls loadJournalEntry.
async function loadJournalPeriodEntry(type, identifier) {
  const id = buildPeriodEntryId(type, identifier);
  return loadJournalEntry(id);
}

// ─── DELETE ────────────────────────────────────────────────
async function deleteJournalEntry(id) {
  if (!_currentUser) return;
  try {
    await _journalCol().doc(id).delete();
  } catch (e) {
    console.error('deleteJournalEntry error:', e);
    throw e;
  }
}

// ─── ENTRY FACTORIES ───────────────────────────────────────
// Helper to create a new empty day entry object with the correct shape.
// Use this instead of building the object manually in journalV2.js.
function makeDayEntry(date) {
  return {
    id:             buildDayEntryId(date),
    type:           'day',
    date,
    account:        activeAccount,
    reflection:     '',
    aiSummary:      '',
    aiGeneratedAt:  null,
    screenshots:    [],   // base64 — session-level screenshots (not per-trade)
    mood:           '',
    createdAt:      null, // set by Firestore serverTimestamp on first save
    updatedAt:      null
  };
}

function makePeriodEntry(type, identifier) {
  return {
    id:            buildPeriodEntryId(type, identifier),
    type,          // 'week' | 'month' | 'year'
    identifier,    // '2026-W26' | '2026-06' | '2026'
    account:       activeAccount,
    reflection:    '',
    aiSummary:     '',
    aiGeneratedAt: null,
    createdAt:     null,
    updatedAt:     null
  };
}

// ─── WEEK IDENTIFIER HELPER ────────────────────────────────
// Returns the ISO week identifier string for a given date: 'YYYY-WWW'.
// Used to build period entry IDs for weekly summaries.
function getWeekIdentifier(date) {
  const d = new Date(date + 'T00:00:00');
  // ISO week: week 1 is the week containing the first Thursday of the year.
  const jan4 = new Date(d.getFullYear(), 0, 4);
  const startOfWeek1 = new Date(jan4);
  startOfWeek1.setDate(jan4.getDate() - ((jan4.getDay() + 6) % 7)); // Monday of week 1
  const weekNum = Math.floor((d - startOfWeek1) / (7 * 24 * 60 * 60 * 1000)) + 1;
  // Handle edge case: day falls in week 1 of next year
  const year = weekNum < 1
    ? d.getFullYear() - 1
    : (weekNum > 52 && d.getMonth() === 11 && d.getDate() >= 29)
      ? d.getFullYear() + 1
      : d.getFullYear();
  const wk = weekNum < 1
    ? getWeekIdentifier(`${year}-12-28`).split('-W')[1]
    : String(weekNum).padStart(2, '0');
  return `${year}-W${wk}`;
}

// ─── EXPOSE PUBLIC API ─────────────────────────────────────
window.saveJournalEntry              = saveJournalEntry;
window.loadJournalEntry              = loadJournalEntry;
window.loadJournalEntriesForMonth    = loadJournalEntriesForMonth;
window.loadJournalPeriodEntry        = loadJournalPeriodEntry;
window.deleteJournalEntry            = deleteJournalEntry;
window.buildDayEntryId               = buildDayEntryId;
window.buildPeriodEntryId            = buildPeriodEntryId;
window.makeDayEntry                  = makeDayEntry;
window.makePeriodEntry               = makePeriodEntry;
window.getWeekIdentifier             = getWeekIdentifier;
