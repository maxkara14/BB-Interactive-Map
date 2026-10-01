# BB Interactive Map

[Русский](README.md)

A scene map and spatial memory extension for SillyTavern. It scans recent chat messages and builds a 3×3 map of the current surroundings.

## Features

- Room and building scale maps with characters, objects, atmosphere, and threat levels.
- Saved map memory per chat, injected into the model context by default.
- A new scan stays a preview until you save it. The previous saved map can be restored in extension settings.
- Existing maps still open; new records include short character and object descriptions.
- A saved map appears in a collapsible chat widget. Drag its header or focus it and use arrow keys to move it; position and collapsed state are saved in settings.
- The chat widget shows a mini map and opens the full map. Scan and manage memory in the **Current chat map** section of extension settings.
- Optionally, the map prepares an update after a completed reply at a selected minimum interval. Each update uses one model request; you can review or discard the proposal, and the map changes only after confirmation.
- Optional `{{bb_map}}` macro for manual prompt placement.
- Interface language: browser language, Russian, or English. Prompts remain in English; map descriptions follow the chat language.
- Scan source: current SillyTavern connection, a Connection Manager profile, or a direct OpenAI-compatible Custom API.
- Existing Custom API settings are preserved. Direct Custom API failures fall back to the main connection; an unavailable profile shows an error.

The two-mode map, floating widget, and light RPG features are being developed in the [`map_test` roadmap](ROADMAP.md).

## Installation

In SillyTavern, open **Extensions → Install extension** and enter:

`https://github.com/maxkara14/BB-Interactive-Map`

Reload the page. Open **Extensions settings → BB Interactive Map → Current chat map** to run the first scan.
