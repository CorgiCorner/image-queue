// @vitest-environment happy-dom
import React from "react";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { Notification } from "@/components/notification";

beforeEach(() => vi.useFakeTimers());
afterEach(() => { cleanup(); vi.useRealTimers(); });
const advance = (ms: number) => act(() => vi.advanceTimersByTime(ms));

it("dismisses a plain notification after four seconds", () => {
  const dismiss = vi.fn();
  render(<Notification message="Copied" onDismiss={dismiss} />);
  advance(3999);
  expect(dismiss).not.toHaveBeenCalled();
  advance(1);
  expect(screen.getByRole("status").getAttribute("data-closing")).toBe("true");
  advance(1);
  expect(dismiss).toHaveBeenCalledOnce();
});

it("allows eight seconds for an action, pauses on hover, and preserves remaining time", () => {
  const dismiss = vi.fn();
  render(<Notification message="Archived" action={<button>Undo</button>} onDismiss={dismiss} />);
  advance(3000);
  fireEvent.mouseEnter(screen.getByRole("status"));
  advance(10000);
  expect(dismiss).not.toHaveBeenCalled();
  fireEvent.mouseLeave(screen.getByRole("status"));
  advance(4999);
  expect(dismiss).not.toHaveBeenCalled();
  advance(1);
  advance(1);
  expect(dismiss).toHaveBeenCalledOnce();
});

it("keeps the clock paused while focus moves between actions and while hovered", () => {
  const dismiss = vi.fn();
  render(<Notification message="Archived" action={<button>Undo</button>} onDismiss={dismiss} />);
  const undo = screen.getByRole("button", { name: "Undo" });
  const close = screen.getByRole("button", { name: "Dismiss notification" });
  fireEvent.focus(undo);
  advance(10000);
  fireEvent.blur(undo, { relatedTarget: close });
  fireEvent.focus(close);
  advance(10000);
  expect(dismiss).not.toHaveBeenCalled();
  fireEvent.mouseEnter(screen.getByRole("status"));
  fireEvent.blur(close, { relatedTarget: null });
  advance(10000);
  expect(dismiss).not.toHaveBeenCalled();
  fireEvent.mouseLeave(screen.getByRole("status"));
  advance(8000);
  advance(1);
  expect(dismiss).toHaveBeenCalledOnce();
});

it("cancels old timers when replaced and uses the latest dismiss callback", () => {
  const old = vi.fn(); const current = vi.fn();
  const view = render(<Notification message="First" onDismiss={old} />);
  advance(3500);
  view.rerender(<Notification message="Second" onDismiss={current} />);
  advance(1000);
  expect(old).not.toHaveBeenCalled();
  expect(current).not.toHaveBeenCalled();
  expect(screen.getAllByRole("status")).toHaveLength(1);
  advance(3000);
  advance(1);
  expect(current).toHaveBeenCalledOnce();
});

it("lets the user dismiss immediately", () => {
  const dismiss = vi.fn();
  render(<Notification message="Copied" onDismiss={dismiss} />);
  fireEvent.click(screen.getByRole("button", { name: "Dismiss notification" }));
  advance(1);
  expect(dismiss).toHaveBeenCalledOnce();
});

it("keeps a replacement paused while the user is hovering",()=>{
 const dismiss=vi.fn();
 const view=render(<Notification message="First" onDismiss={dismiss}/>);
 fireEvent.mouseEnter(screen.getByRole('status'));
 view.rerender(<Notification message="Second" onDismiss={dismiss}/>);
 advance(10000);expect(dismiss).not.toHaveBeenCalled();
 fireEvent.mouseLeave(screen.getByRole('status'));
 advance(4000);advance(1);expect(dismiss).toHaveBeenCalledOnce();
});
it("reopens a notification replaced during its exit",()=>{
 const dismiss=vi.fn();
 const view=render(<Notification message="First" onDismiss={dismiss}/>);
 fireEvent.click(screen.getByRole('button',{name:'Dismiss notification'}));
 view.rerender(<Notification message="Second" onDismiss={dismiss}/>);
 expect(screen.getByRole('status').hasAttribute('data-closing')).toBe(false);
 advance(3999);expect(dismiss).not.toHaveBeenCalled();
 advance(1);advance(1);expect(dismiss).toHaveBeenCalledOnce();
});
