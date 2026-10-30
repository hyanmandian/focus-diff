export const fakeOs = { mac: false };

export const withFakeOs = (real: object) => ({
  ...real,
  get isMac() {
    return fakeOs.mac;
  },
  primary: (e: Pick<KeyboardEvent, "metaKey" | "ctrlKey">) => (fakeOs.mac ? e.metaKey : e.ctrlKey),
});
