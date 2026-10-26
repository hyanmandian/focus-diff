// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";

import { pageBody } from "./page-body";

describe("pageBody", () => {
  it("gives the body's markup without any script, whatever its case", () => {
    const html = `<!doctype html><html><head><title>x</title></head><body><main id="m">Hi</main><SCRIPT src="a.js"></SCRIPT><script>alert(1)</script ></body></html>`;
    expect(pageBody(html)).toBe('<main id="m">Hi</main>');
  });
});
