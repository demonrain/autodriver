// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import App from "./App";

describe("App", () => {
  it("renders the primary magnet search workflow", () => {
    render(<App />);

    expect(screen.getByText("磁力元数据查询平台")).toBeInTheDocument();
    expect(screen.getByPlaceholderText(/magnet:\?xt=urn:btih/i)).toBeInTheDocument();
  });
});
