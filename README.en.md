# BB Interactive Map

[Русский](README.md)

A scene map and spatial memory extension for SillyTavern. It scans recent chat messages and builds a 3×3 map of the current surroundings.

## Features

- Room and building scale maps with characters, objects, atmosphere, and threat levels.
- Saved map memory per chat, injected into the model context by default.
- A new scan stays a preview until you save it. The previous saved map can be restored in extension settings.
- The preview lists changes to zones, threats, characters, and objects. Repeated names are marked as ambiguous.
- **Edit map** opens fields for the location, atmosphere, and existing zones. Correct descriptions and threats, add or remove objects and characters, or move them to another existing zone. Edits return to the preview and are written only when you save.
- Existing maps still open; new records include short character and object descriptions.
- A saved map appears in a collapsible chat widget. Drag its header or focus it and use arrow keys to move it; position and collapsed state are saved in settings.
- The chat widget shows a mini map and opens the full map. Scan and manage memory in the **Current chat map** section of extension settings.
- Optionally, the map prepares an update after a character reply, including rerolls. Each update uses one model request. By default, proposals wait for review; a separate setting saves them automatically without confirmation and keeps the previous map for rollback.
- Enable **Highlight map mentions in chat** under **Interface** (off by default) to click character, object, and zone names for a card with their description and location from the saved map. Unique character first and last names also match separately, including before honorifics such as "-san". Visual separators such as `ㅤ` are treated as spaces during matching. Highlighting runs locally without model requests or message writes; ambiguous mentions, code, links, and inputs are skipped. Inflections, nicknames, transliterations, and names split by HTML markup are not matched yet.
- Choose **Classic** (default) or **Game** under **Current chat map**. The mode is saved per chat without changing the map or its rollback snapshot. In game mode, select a neighboring zone on the saved full map to see the route, threat level, and reason, then use **Prepare travel** to append an action to your draft. Existing text is preserved; sending remains manual. Preparing travel neither moves the player nor requests a model response. A subsequent manual or automatic scan reflects the narrative outcome. Travel requires a center zone representing the player's position and is unavailable on unsaved proposals.
- Game instructions apply to injected memory and `{{bb_map}}` only in game mode: threats are circumstances, and requested travel remains an attempt until the narrative establishes its outcome. There are no automatic damage calculations or rolls. Game scans omit unknown neighboring zones even at building scale. Returning to Classic hides travel controls and removes game instructions. Item ownership and temporary effects are planned for later.
- Optional `{{bb_map}}` macro for manual prompt placement.
- Interface language: browser language, Russian, or English. Prompts remain in English; map descriptions follow the chat language.
- Scan source: current SillyTavern connection, a Connection Manager profile, or a direct OpenAI-compatible Custom API.
- Existing Custom API settings are preserved. Direct Custom API failures fall back to the main connection; an unavailable profile shows an error.

The two-mode map, floating widget, and light RPG features are being developed in the [`map_test` roadmap](ROADMAP.md).

## Installation

In SillyTavern, open **Extensions → Install extension** and enter:

`https://github.com/maxkara14/BB-Interactive-Map`

Reload the page. Open **Extensions settings → BB Interactive Map → Current chat map** to run the first scan.
