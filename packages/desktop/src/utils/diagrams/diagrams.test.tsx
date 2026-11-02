import { render, screen, waitFor } from "@testing-library/react";
import type { renderAsync } from "pele/lazy";
import { useRef } from "react";
import { describe, expect, it, vi } from "vite-plus/test";

import { useDiagrams } from "@/utils/diagrams/diagrams";
import { setLanguage } from "@/utils/i18n/i18n";

const pele = vi.hoisted(() => ({ renderAsync: vi.fn<typeof renderAsync>() }));
vi.mock("pele/lazy", () => ({ renderAsync: pele.renderAsync }));

type Drawn = Awaited<ReturnType<typeof renderAsync>>;
const result = (svg: string): Drawn => ({
  svg,
  width: 0,
  height: 0,
  links: [],
  type: "flowchart",
  mermaidType: "flowchart-v2",
});
const drew = (svg: string) => pele.renderAsync.mockResolvedValue(result(svg));

function Page({ html }: { html: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useDiagrams(ref, html);
  return <div ref={ref} dangerouslySetInnerHTML={{ __html: html }} />;
}

function Unshown({ html }: { html: string }) {
  useDiagrams(useRef<HTMLDivElement>(null), html);
  return null;
}

const flowchart = '<pre data-mermaid="">flowchart LR\n  A --&gt; B</pre>';

describe("useDiagrams", () => {
  it("draws each diagram, its source a click away, without links or images", async () => {
    drew("<svg><text>A to B</text></svg>");
    render(<Page html={`<p>Before</p>${flowchart}${flowchart}`} />);
    const pictures = await screen.findAllByRole("img", { name: "Diagram: flowchart LR" });
    expect(pictures.map((p) => p.innerHTML)).toEqual([
      "<svg><text>A to B</text></svg>",
      "<svg><text>A to B</text></svg>",
    ]);
    expect(screen.getAllByText("Source")).toHaveLength(2);
    const [first, second] = pele.renderAsync.mock.calls.map(([source, options]) => ({ source, ...options }));
    expect(first).toMatchObject({
      source: "flowchart LR\n  A --> B",
      links: false,
      images: false,
      maxWidth: 1040,
      autoDirection: true,
    });
    expect(first!.idPrefix).not.toBe(second!.idPrefix);
  });

  it("fits it to the space it has, turning a wide flowchart on its side", async () => {
    drew("<svg></svg>");
    const { container } = render(<Page html={flowchart} />);
    Object.defineProperty(container.firstElementChild!, "clientWidth", { value: 500 });
    await screen.findByRole("img");
    expect(pele.renderAsync.mock.calls[0]![1]).toMatchObject({ maxWidth: 650 });
  });

  it("names it in the app's language", async () => {
    setLanguage("pt-BR");
    drew("<svg></svg>");
    render(<Page html={flowchart} />);
    expect(await screen.findByRole("img", { name: "Diagrama: flowchart LR" })).toBeTruthy();
    expect(screen.getByText("Código")).toBeTruthy();
    setLanguage("en");
  });

  it("leaves the source when it can't be drawn", async () => {
    pele.renderAsync.mockRejectedValue(new Error("syntax"));
    const { container } = render(<Page html={'<pre data-mermaid="">not a diagram</pre>'} />);
    await waitFor(() => {
      expect(pele.renderAsync).toHaveBeenCalled();
    });
    expect(container.querySelector("pre")?.textContent).toBe("not a diagram");
    expect(screen.queryByRole("img")).toBeNull();
  });

  it("skips a diagram gone before or while it's drawn", async () => {
    drew("<svg></svg>");
    const before = render(<Page html={flowchart} />);
    before.unmount();
    let finish: (drawn: Drawn) => void = () => {};
    pele.renderAsync.mockReturnValueOnce(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    const during = render(<Page html={flowchart} />);
    await waitFor(() => {
      expect(pele.renderAsync).toHaveBeenCalledOnce();
    });
    const pre = during.container.querySelector("pre")!;
    during.unmount();
    finish(result("<svg></svg>"));
    await new Promise((resolve) => {
      setTimeout(resolve, 0);
    });
    expect(pre.isConnected).toBe(false);
    expect(document.querySelector("figure")).toBeNull();
  });

  it("tries again after pele fails to load", async () => {
    vi.resetModules();
    vi.doMock("pele/lazy", () => {
      throw new Error("gone");
    });
    const fresh = await import("@/utils/diagrams/diagrams");
    function Fresh({ html }: { html: string }) {
      const ref = useRef<HTMLDivElement>(null);
      fresh.useDiagrams(ref, html);
      return <div ref={ref} dangerouslySetInnerHTML={{ __html: html }} />;
    }
    const first = render(<Fresh html={flowchart} />);
    await new Promise((resolve) => {
      setTimeout(resolve, 0);
    });
    expect(first.container.querySelector("pre[data-mermaid]")).toBeTruthy();
    first.unmount();
    vi.doMock("pele/lazy", () => ({ renderAsync: pele.renderAsync }));
    drew("<svg></svg>");
    render(<Fresh html={flowchart} />);
    expect(await screen.findByRole("img", { name: "Diagram: flowchart LR" })).toBeTruthy();
    vi.doUnmock("pele/lazy");
  });

  it("does nothing without diagrams, or without HTML", () => {
    const { rerender } = render(<Page html="<p>Plain</p>" />);
    rerender(<Page html="<p>Plain</p>" />);
    render(<Page html="" />);
    render(<Unshown html={flowchart} />);
    expect(pele.renderAsync).not.toHaveBeenCalled();
  });
});
