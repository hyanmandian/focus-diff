import { render, screen, waitFor } from "@testing-library/react";
import { useRef } from "react";
import { describe, expect, it, vi } from "vite-plus/test";

import { useDiagrams } from "@/utils/diagrams/diagrams";
import { setLanguage } from "@/utils/i18n/i18n";

const mermaid = vi.hoisted(() => ({
  initialize: vi.fn<(config: { theme: string }) => void>(),
  render: vi.fn<(id: string, source: string) => Promise<{ svg: string }>>(),
}));
vi.mock("mermaid", () => ({ default: mermaid }));

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
  it("draws a diagram, its source a click away", async () => {
    mermaid.render.mockResolvedValue({ svg: "<svg><text>A to B</text></svg>" });
    render(<Page html={`<p>Before</p>${flowchart}`} />);
    const picture = await screen.findByRole("img", { name: "Diagram: flowchart LR" });
    expect(picture.innerHTML).toBe("<svg><text>A to B</text></svg>");
    expect(screen.getByText("Source")).toBeTruthy();
    expect(mermaid.render).toHaveBeenCalledWith(expect.stringMatching(/^diagram-\d+$/u), "flowchart LR\n  A --> B");
    expect(mermaid.initialize).toHaveBeenCalledWith(
      expect.objectContaining({ securityLevel: "strict", theme: "default" }),
    );
  });

  it("names it in the app's language", async () => {
    setLanguage("pt-BR");
    mermaid.render.mockResolvedValue({ svg: "<svg></svg>" });
    render(<Page html={flowchart} />);
    expect(await screen.findByRole("img", { name: "Diagrama: flowchart LR" })).toBeTruthy();
    expect(screen.getByText("Código")).toBeTruthy();
    setLanguage("en");
  });

  it("draws in the dark theme when the page is dark", async () => {
    document.documentElement.classList.add("dark");
    mermaid.render.mockResolvedValue({ svg: "<svg></svg>" });
    render(<Page html={flowchart} />);
    await screen.findByRole("img");
    document.documentElement.classList.remove("dark");
    expect(mermaid.initialize).toHaveBeenLastCalledWith(expect.objectContaining({ theme: "dark" }));
  });

  it("leaves the source when mermaid can't draw it", async () => {
    mermaid.render.mockRejectedValue(new Error("syntax"));
    const { container } = render(<Page html={'<pre data-mermaid="">not a diagram</pre>'} />);
    await waitFor(() => {
      expect(mermaid.render).toHaveBeenCalled();
    });
    expect(container.querySelector("pre")?.textContent).toBe("not a diagram");
    expect(screen.queryByRole("img")).toBeNull();
  });

  it("skips a diagram gone before its turn", async () => {
    mermaid.render.mockClear();
    const { unmount } = render(<Page html={flowchart} />);
    unmount();
    await Promise.resolve();
    await new Promise((resolve) => {
      setTimeout(resolve, 0);
    });
    expect(mermaid.render).not.toHaveBeenCalled();
  });

  it("does nothing without diagrams, or without HTML", () => {
    mermaid.render.mockClear();
    const { rerender } = render(<Page html="<p>Plain</p>" />);
    rerender(<Page html="<p>Plain</p>" />);
    render(<Page html="" />);
    render(<Unshown html={flowchart} />);
    expect(mermaid.render).not.toHaveBeenCalled();
  });
});
