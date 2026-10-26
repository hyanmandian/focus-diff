// A file stays viewed until its changes do, so viewed marks are keyed by a hash of its patch. A
// patch can be large and the hash is asked for on every render (the list, the totals, the next
// file), so each file's is worked out once: the file objects of one load don't change, and a new
// load brings new ones.

/** A short, stable hash of a string (djb2, base 36). */
export const hash = (s: string) => {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return h.toString(36);
};

const known = new WeakMap<object, string>();

/** The hash of a file's patch, once per file object. */
export function patchHash(file: { patch: string }) {
  let h = known.get(file);
  if (h === undefined) {
    h = hash(file.patch);
    known.set(file, h);
  }
  return h;
}
