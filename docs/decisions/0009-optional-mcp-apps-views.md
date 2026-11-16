---
status: proposed
date: 2026-11-14
---

# Offer MCP Apps views as an optional layer over the MCP tools

## Context and Problem Statement

Agents reach image-queue through MCP tools that return text and file paths. See [ADR-0004](0004-mcp-is-the-primary-interface-for-agents.md).
In a chat host the user then has to open the panel or the file to see the image.
Hosted image connectors now show the job and its result inline in the conversation, using the MCP Apps extension.
Should image-queue do the same, and how does that fit a local-first tool whose results stay on disk?

## Decision Drivers

* Seeing the result where it was requested is the shortest path to an image.
* The model's context must stay small. Image bytes must never enter it.
* Everything must keep working with no outside service. See [ADR-0001](0001-everything-except-image-generation-works-locally.md).
* Terminal agents and hosts without the extension must lose nothing.
* The views must not become a second panel with its own logic.

## Considered Options

* No views, text results only
* Optional views built on the MCP Apps extension
* Host-specific widgets for one chat product
* A link to the local panel in every tool result

## Decision Outcome

Chosen option: "Optional views built on the MCP Apps extension", because it is the one standard several hosts implement and it can be added without changing any tool result.

Rules:

* A view is progressive enhancement. The text result of every tool is complete without it and identical with and without it.
* UI metadata is registered only when the host declares the extension during capability negotiation.
* Image bytes never appear in a tool result, neither in `content` nor in `structuredContent`. A view loads thumbnails itself, through a tool visible only to the view or through a resource read.
* A view asks for images by record identifier, never by file path. The folder limits of ADR-0004 apply to every call a view makes.
* Each view is one bundled HTML file served by the local MCP server. It loads nothing from the network, so its content security policy lists no external origins.
* A view calls the same core use cases as the panel and the model-facing tools. It holds no rules of its own.
* Tools that create several requests at once do not open a view.
* No destructive action is available from a view. An action that spends money needs an explicit click and follows the durable execution rule.

### Consequences

* Good, because the result shows up in the conversation with no extra step.
* Good, because hosts without the extension behave exactly as before.
* Good, because the views work offline and over stdio.
* Bad, because the main users, coding agents in a terminal, get nothing from it.
* Bad, because every view is one more surface to keep in step with the panel.
* Bad, because the extension is young and hosts differ in what they allow a view to do.

### Confirmation

* A test compares the text result of each tool with and without the UI capability and expects no difference.
* A test checks that no tool result contains image data.
* A test checks that a view cannot obtain a file outside the store, whatever arguments it sends.
* Each view is exercised against a fake host bridge, and by hand in the reference host of the extension.

## Pros and Cons of the Options

### No views

* Good, because there is nothing to build or maintain.
* Bad, because the user leaves the conversation for every result.

### Optional views built on MCP Apps

* Good, because one implementation serves every compliant host.
* Bad, because behavior still has to be checked host by host.

### Host-specific widgets

* Good, because one host can be polished further.
* Bad, because it ties the product to one vendor, against [ADR-0008](0008-provider-neutral-names.md).

### A link to the local panel

* Good, because it costs almost nothing and works in a terminal too.
* Bad, because it is still a context switch. It stays as the fallback inside every view and every text result.

## More Information

Open questions before this record is accepted:

* Which hosts that the user actually works in render views from a local stdio server?
* Does each of those hosts keep `structuredContent` out of the model's context? The rule above does not depend on the answer, but the size of text results might.
* Is opening a `localhost` link from a view allowed in each host?
