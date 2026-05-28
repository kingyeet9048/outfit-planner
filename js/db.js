import { openDB } from './vendor/idb.js';

export const DB_NAME = 'outfit-planner';
export const DB_VERSION = 1;

export async function open(name = DB_NAME) {
  return openDB(name, DB_VERSION, {
    upgrade(db, oldVersion, newVersion, tx) {
      if (!db.objectStoreNames.contains('items')) {
        const items = db.createObjectStore('items', { keyPath: 'id' });
        items.createIndex('by_category', 'category');
        items.createIndex('by_owned', 'owned');
        items.createIndex('by_createdAt', 'createdAt');
      }
      if (!db.objectStoreNames.contains('outfits')) {
        const outfits = db.createObjectStore('outfits', { keyPath: 'id' });
        outfits.createIndex('by_createdAt', 'createdAt');
      }
      if (!db.objectStoreNames.contains('trips')) {
        const trips = db.createObjectStore('trips', { keyPath: 'id' });
        trips.createIndex('by_startDate', 'startDate');
      }
      if (!db.objectStoreNames.contains('dayPlans')) {
        const days = db.createObjectStore('dayPlans', { keyPath: 'id' });
        days.createIndex('by_tripId', 'tripId');
      }
    }
  });
}

// UUID with fallback for older WebKit
export function uuid() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const h = [...bytes].map(b => b.toString(16).padStart(2, '0'));
  return `${h.slice(0, 4).join('')}-${h.slice(4, 6).join('')}-${h.slice(6, 8).join('')}-${h.slice(8, 10).join('')}-${h.slice(10, 16).join('')}`;
}

let cachedDb = null;
export async function getDb() {
  if (!cachedDb) cachedDb = await open();
  return cachedDb;
}

// Reset cached connection — used by tests.
export function _resetCache() { cachedDb = null; }
// Inject a specific db connection (e.g. against a test DB). Used by tests only.
export function _setTestDb(conn) { cachedDb = conn; }
