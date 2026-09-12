import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ui = join(import.meta.dir, "..");
const source = (name: string) => readFileSync(join(ui, name), "utf8");

test("resizable wrapper uses react-resizable-panels v4 exports", () => {
  const code = source("resizable.tsx");
  expect(code).toContain("ResizablePrimitive.Group");
  expect(code).toContain("ResizablePrimitive.Separator");
  expect(code).not.toContain("ResizablePrimitive.PanelGroup");
  expect(code).not.toContain("ResizablePrimitive.PanelResizeHandle");
});

test("tooltip roots rely on the shared provider instead of nesting one per tooltip", () => {
  const code = source("tooltip.tsx");
  const start = code.indexOf("function Tooltip({");
  const end = code.indexOf("\n}\n", start) + 3;
  const implementation = code.slice(start, end);
  expect(implementation).toContain("<TooltipPrimitive.Root");
  expect(implementation).not.toContain("<TooltipProvider>");
});

test("sidebar exposes the documented offcanvas collapse mode", () => {
  const code = source("sidebar.tsx");
  expect(code).toContain('collapsible = "offcanvas"');
  expect(code).toContain('collapsible?: "offcanvas" | "icon" | "none"');
  expect(code).not.toContain("offExamples");
});

test("sidebar tooltip trigger is passed to useRender as an element", () => {
  const code = source("sidebar.tsx");
  expect(code).toContain('render: !tooltip ? render : <TooltipTrigger render={render} />');
  expect(code).not.toContain("render: !tooltip ? render : TooltipTrigger");
});

test("vertical carousels use vertical arrow keys", () => {
  const code = source("carousel.tsx");
  expect(code).toContain('orientation === "vertical" ? "ArrowUp" : "ArrowLeft"');
  expect(code).toContain('orientation === "vertical" ? "ArrowDown" : "ArrowRight"');
});

test("aspect ratio preserves caller styles while owning the ratio variable", () => {
  const code = source("aspect-ratio.tsx");
  expect(code).toContain("style,");
  expect(code).toMatch(/style=\{[\s\S]*\.\.\.style,[\s\S]*"--ratio": ratio/);
});

test("ItemGroup identifies the collection without overriding polymorphic Item roles", () => {
  const code = source("item.tsx");
  expect(code).toContain('role="list"');
  const start = code.indexOf("function Item(");
  const end = code.indexOf("const itemMediaVariants", start);
  expect(start).toBeGreaterThan(-1);
  expect(end).toBeGreaterThan(start);
  expect(code.slice(start, end)).not.toContain('role: "listitem"');
});

test("slider className is applied to its root", () => {
  const code = source("slider.tsx");
  expect(code).toMatch(/<SliderPrimitive\.Root[\s\S]*className=\{cn\([\s\S]*className/);
  expect(code).not.toMatch(/<SliderPrimitive\.Control[\s\S]*className=\{cn\([\s\S]*className/);
});

test("input group addon composes onClick and focuses either supported control", () => {
  const code = source("input-group.tsx");
  expect(code).toMatch(/function InputGroupAddon\(\{[\s\S]*onClick,[\s\S]*\.\.\.props/);
  expect(code).toContain('querySelector<HTMLElement>(\'[data-slot="input-group-control"]\')');
  expect(code).toMatch(/\.\.\.props[\s\S]*onClick=\{\(e\) => \{[\s\S]*onClick\?\.\(e\)/);
});

test("sidebar trigger composes caller click before guaranteed toggle", () => {
  const code = source("sidebar.tsx");
  const start = code.indexOf("function SidebarTrigger");
  const end = code.indexOf("function SidebarRail", start);
  expect(start).toBeGreaterThan(-1);
  expect(end).toBeGreaterThan(start);
  const implementation = code.slice(start, end);
  const propsSpread = implementation.indexOf("{...props}");
  const handler = implementation.indexOf("onClick={(event)");
  const caller = implementation.indexOf("onClick?.(event)", handler);
  const toggle = implementation.indexOf("toggleSidebar()", handler);
  expect(propsSpread).toBeGreaterThan(-1);
  expect(handler).toBeGreaterThan(propsSpread);
  expect(caller).toBeGreaterThan(handler);
  expect(toggle).toBeGreaterThan(caller);
});

test("sidebar constant aliases use value types instead of React props types", () => {
  const code = source("sidebar.tsx");
  expect(code).not.toMatch(/React\.ComponentProps<typeof SIDEBAR_/);
  expect(code).toContain("export type SIDEBAR_COOKIE_NAMEProps = typeof SIDEBAR_COOKIE_NAME");
});

test("sonner is explicitly client-side", () => {
  const code = source("sonner.tsx");
  expect(code.startsWith('"use client"')).toBe(true);
});


test("scroll area examples do not add a duplicate vertical scrollbar", () => {
  const code = source("scroll-area.tsx");
  expect(code).not.toContain('<ScrollBar orientation="vertical" />');
});

test("command dialog keeps accessible metadata inside dialog content", () => {
  const code = source("command.tsx");
  const start = code.indexOf("function CommandDialog");
  const end = code.indexOf("function CommandInput", start);
  const implementation = code.slice(start, end);
  expect(implementation.indexOf("<DialogContent")).toBeLessThan(implementation.indexOf("<DialogHeader"));
  expect(implementation.indexOf("<DialogHeader")).toBeLessThan(implementation.indexOf("</DialogContent>"));
});

test("empty state dashed outline includes a border width", () => {
  const code = source("empty.tsx");
  expect(code).toContain("rounded-lg border border-dashed");
});

test("carousel keyboard navigation ignores embedded interactive controls", () => {
  const code = source("carousel.tsx");
  expect(code).toContain("target.isContentEditable");
  expect(code).toContain("input, select, textarea");
  expect(code).toContain("[role='slider']");
});

test("input group is explicitly client-side", () => {
  const code = source("input-group.tsx");
  expect(code.startsWith('"use client"')).toBe(true);
});

test("Base UI menu items style highlighted state rather than DOM focus", () => {
  for (const name of ["context-menu.tsx", "dropdown-menu.tsx"]) {
    const code = source(name);
    expect(code).toContain("data-[highlighted]:bg-accent");
    expect(code).not.toContain("focus:bg-accent");
    expect(code).not.toContain("focus:text-accent-foreground");
  }
});

test("polymorphic Item does not override anchor semantics with listitem role", () => {
  const code = source("item.tsx");
  const start = code.indexOf("function Item(");
  const end = code.indexOf("const itemMediaVariants", start);
  expect(start).toBeGreaterThan(-1);
  expect(end).toBeGreaterThan(start);
  expect(code.slice(start, end)).not.toContain('role: "listitem"');
});

test("input OTP is typechecked", () => {
  const code = source("input-otp.tsx");
  expect(code).not.toContain("@ts-nocheck");
});

test("Tabs forwards orientation to the Base UI root", () => {
  const code = source("tabs.tsx");
  const start = code.indexOf("<TabsPrimitive.Root");
  const end = code.indexOf("/>", start);
  expect(code.slice(start, end)).toMatch(/\n\s+orientation=\{orientation\}/);
});

test("slider thumbs are indexed and have accessible labels", () => {
  const code = source("slider.tsx");
  expect(code).toContain("getAriaLabel");
  expect(code).toContain("index={index}");
  expect(code).toContain("getAriaLabel={thumbAriaLabel}");
});

test("KbdGroup props match its rendered kbd element", () => {
  const code = source("kbd.tsx");
  expect(code).toContain('function KbdGroup({ className, ...props }: React.ComponentProps<"kbd">)');
});

test("mobile Sidebar forwards DOM props and className to SheetContent", () => {
  const code = source("sidebar.tsx");
  const mobileStart = code.indexOf("if (isMobile)");
  const mobileEnd = code.indexOf("return (", mobileStart + 30);
  const nextDesktop = code.indexOf("return (", mobileEnd + 10);
  const mobile = code.slice(mobileStart, nextDesktop);
  expect(mobile).toContain('<Sheet open={openMobile} onOpenChange={setOpenMobile}>');
  expect(mobile).toContain('className={cn(');
  expect(mobile).toContain('className');
  expect(mobile).toContain('{...props}');
});


test("mobile Sidebar merges caller styles with its default width variable", () => {
  const code = source("sidebar.tsx");
  const start = code.indexOf("if (isMobile)");
  const end = code.indexOf("return (", code.indexOf("return (", start) + 10);
  const mobile = code.slice(start, end);
  expect(code).toMatch(/function Sidebar\(\{[\s\S]*style,[\s\S]*\.\.\.props/);
  expect(mobile).toMatch(/style=\{[\s\S]*"--sidebar-width": SIDEBAR_WIDTH_MOBILE,[\s\S]*\.\.\.style/);
});
