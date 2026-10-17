/// <reference types="node" />
// @vitest-environment happy-dom
// Phase 16c: the theme switch — chosen per device, Match system following the computer,
// ◐ stepping Dark → Light → Paper, and index.html showing it before anything draws.

import { readFileSync } from "node:fs";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../audio/engine", async () =>
  (await import("../test/fakeEngine")).fakeEngine(),
);

/** A computer set to light or dark, that can change while the page is open. */
function fakeSystem(light: boolean) {
  const heard = new Set<() => void>();
  const query = {
    get matches() {
      return light;
    },
    addEventListener: (_: string, fn: () => void) => heard.add(fn),
    removeEventListener: (_: string, fn: () => void) => heard.delete(fn),
  };
  vi.stubGlobal("matchMedia", () => query);
  return (now: boolean) => {
    light = now;
    heard.forEach((fn) => fn());
  };
}

const root = () => document.documentElement;
/** Stops the theme modules started so far (each test's page is a fresh one). */
const stops: (() => void)[] = [];
/** The theme module afresh (as on loading the page); its startTheme is stopped after the test. */
const load = async () => {
  vi.resetModules();
  const t = await import("./theme");
  const start = t.startTheme;
  return {
    ...t,
    startTheme: () => {
      const stop = start();
      stops.push(stop);
      return stop;
    },
  };
};

beforeEach(() => {
  localStorage.clear();
  delete root().dataset.theme;
  fakeSystem(false);
});
afterEach(() => {
  stops.splice(0).forEach((stop) => stop());
  vi.unstubAllGlobals();
});

describe("the theme", () => {
  it("Dark until one is chosen; a choice is kept for this device", async () => {
    const t = await load();
    t.startTheme();
    expect([t.themeChoice(), t.shownTheme(), root().dataset.theme]).toEqual([
      "dark",
      "dark",
      undefined,
    ]);
    t.setTheme("paper");
    expect([
      root().dataset.theme,
      localStorage.getItem("harpforge:theme"),
    ]).toEqual(["paper", "paper"]);
    // Loading the page again: still Paper.
    delete root().dataset.theme;
    const again = await load();
    again.startTheme();
    expect(again.shownTheme()).toBe("paper");
  });

  it("something else kept under its name: Dark", async () => {
    localStorage.setItem("harpforge:theme", "neon");
    const t = await load();
    t.startTheme();
    expect([t.themeChoice(), t.shownTheme()]).toEqual(["dark", "dark"]);
  });

  it("Match system: Light or Dark as the computer is set, and follows it when it changes", async () => {
    const setSystem = fakeSystem(true);
    const t = await load();
    t.startTheme();
    t.setTheme("system");
    expect(t.shownTheme()).toBe("light");
    setSystem(false);
    expect(t.shownTheme()).toBe("dark");
    // A theme chosen outright doesn't follow the computer.
    t.setTheme("paper");
    setSystem(true);
    expect(t.shownTheme()).toBe("paper");
  });

  it("◐ steps Dark → Light → Paper → Dark from what is shown, and keeps that choice", async () => {
    fakeSystem(true);
    const t = await load();
    t.startTheme();
    t.setTheme("system"); // shows Light
    t.cycleTheme();
    expect([t.shownTheme(), t.themeChoice()]).toEqual(["paper", "paper"]);
    t.cycleTheme();
    expect([t.shownTheme(), t.themeChoice()]).toEqual(["dark", "dark"]);
    t.cycleTheme();
    expect(t.shownTheme()).toBe("light");
  });

  it("chosen in another tab: this one follows", async () => {
    const t = await load();
    t.startTheme();
    localStorage.setItem("harpforge:theme", "light");
    window.dispatchEvent(
      new StorageEvent("storage", {
        key: "harpforge:theme",
        newValue: "light",
      }),
    );
    expect(t.shownTheme()).toBe("light");
  });

  it("the colours change all at once (no fading), then transitions come back", async () => {
    const t = await load();
    t.startTheme();
    t.setTheme("light");
    expect(root().classList.contains("theme-switching")).toBe(true);
    await new Promise((r) => setTimeout(r, 5));
    expect(root().classList.contains("theme-switching")).toBe(false);
  });
});

describe("index.html: the theme before anything draws", () => {
  const html = readFileSync(`${process.cwd()}/index.html`, "utf8");
  const inline = /<script>([^]*?)<\/script>/.exec(html)?.[1] ?? "";

  it.each([
    [null, false],
    ["dark", false],
    ["light", false],
    ["paper", true],
    ["system", true],
    ["system", false],
    ["neon", true],
  ] as const)(
    "stored %s (computer light: %s): the same theme the app shows",
    async (stored, light) => {
      fakeSystem(light);
      if (stored) localStorage.setItem("harpforge:theme", stored);
      expect(inline).toContain("harpforge:theme");
      new Function(inline)();
      const early = root().dataset.theme ?? "dark";
      const t = await load();
      expect(early).toBe(t.resolve(t.themeChoice()));
    },
  );
});

describe("the switch", () => {
  it("the account menu lists the four, marks this device’s, and picking one shows it", async () => {
    (
      globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    vi.resetModules();
    const { startTheme } = await import("./theme");
    stops.push(startTheme());
    const { useApp } = await import("./store");
    const { AccountMenu } = await import("../components/Account");
    useApp.setState({ account: { status: "guest", name: null } as never });
    const host = document.createElement("div");
    document.body.append(host);
    const r = createRoot(host);
    await act(async () => r.render(<AccountMenu />));
    await act(async () =>
      host.querySelector<HTMLButtonElement>("button")!.click(),
    );
    const picks = () =>
      [...host.querySelectorAll("[role=menuitemradio]")].map(
        (b) =>
          `${b.querySelector(".mi-name")!.textContent}${b.getAttribute("aria-checked") === "true" ? " ✓" : ""}`,
      );
    expect(picks()).toEqual(["Dark ✓", "Light", "Paper", "Match system"]);
    expect(host.textContent).toContain("Theme (this device)");
    await act(async () =>
      [
        ...host.querySelectorAll<HTMLButtonElement>("[role=menuitemradio]"),
      ][1].click(),
    );
    expect(root().dataset.theme).toBe("light");
    await act(async () =>
      host.querySelector<HTMLButtonElement>("button")!.click(),
    );
    expect(picks()).toEqual(["Dark", "Light ✓", "Paper", "Match system"]);
    // One named group, the four in it.
    const group = host.querySelector("[role=group]")!;
    expect(
      document.getElementById(group.getAttribute("aria-labelledby")!)
        ?.textContent,
    ).toBe("Theme (this device)");
    expect(group.querySelectorAll("[role=menuitemradio]").length).toBe(4);
    await act(async () => r.unmount());
    host.remove();
  });
});

describe("“Match system (now …)” in the menu", () => {
  it("says what the computer is set to now, also after it changes", async () => {
    (
      globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    const setSystem = fakeSystem(false);
    vi.resetModules();
    const { startTheme } = await import("./theme");
    stops.push(startTheme());
    const { useApp } = await import("./store");
    const { AccountMenu } = await import("../components/Account");
    useApp.setState({ account: { status: "guest", name: null } as never });
    const host = document.createElement("div");
    document.body.append(host);
    const r = createRoot(host);
    await act(async () => r.render(<AccountMenu />));
    const hint = async () => {
      await act(async () =>
        host.querySelector<HTMLButtonElement>("button")!.click(),
      );
      const text = [...host.querySelectorAll("[role=menuitemradio]")].at(
        -1,
      )!.textContent;
      await act(async () =>
        host.querySelector<HTMLButtonElement>("button")!.click(),
      );
      return text;
    };
    expect(await hint()).toContain("(now Dark)");
    await act(async () => setSystem(true));
    expect(await hint()).toContain("(now Light)");
    await act(async () => r.unmount());
    host.remove();
  });
});
