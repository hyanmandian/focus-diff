export const hash = (s: string) => {
  let h = 5381;
  // oxlint-disable-next-line unicorn/prefer-math-trunc, unicorn/prefer-code-point -- see above
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return h.toString(36);
};

const known = new WeakMap<object, string>();

export function patchHash(file: { patch: string }) {
  let h = known.get(file);
  if (h === undefined) {
    h = hash(file.patch);
    known.set(file, h);
  }
  return h;
}
