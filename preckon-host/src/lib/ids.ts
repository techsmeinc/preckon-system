import { uuidv7 } from "uuidv7";

/** Time-ordered UUIDv7 — PKs sort chronologically and index well (§0.3). */
export function newId(): string {
  return uuidv7();
}
