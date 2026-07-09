// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import App from "./App";

describe("App", () => {
  it("renders the primary magnet search workflow", () => {
    render(<App />);

    expect(screen.getByText("窝要验牌")).toBeInTheDocument();
    expect(screen.getByText("先偷看一眼，再决定要不要下")).toBeInTheDocument();
    expect(screen.getByText("验牌排行榜")).toBeInTheDocument();
    expect(
      screen.getByText("游客仅看名称与分数；登录后可查看完整磁力链接")
    ).toBeInTheDocument();
    expect(screen.getByPlaceholderText(/magnet:\?xt=urn:btih/i)).toBeInTheDocument();
  });
});
