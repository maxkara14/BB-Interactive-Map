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
- **Travel writing:** Simple text uses the template without a request. Through Enhance Gen uses a compatible installed Enhance API: provide an optional intention and choose **Write action · Enhance**. Completed prose is appended using Enhance's connection, language, narrative person and Director “Me” token limit. Sending remains manual. Cancel in the map or restore the original draft in Enhance. Update both extensions; Simple text remains available without compatible Enhance. Errors never silently prepare a simple action or replace your draft.
- Game instructions apply to injected memory and `{{bb_map}}` only in game mode: threats are circumstances, and requested travel remains an attempt until the narrative establishes its outcome. There are no automatic damage calculations or rolls. Game scans omit unknown neighboring zones even at building scale. Returning to Classic hides travel controls and removes game instructions.
- **Scene objects** follows the current scene. Surroundings and loose objects absent from a scan do not become permanent unknown entries. Established player possessions follow the player even without repeated mentions; other characters' possessions follow them only while their holders are present in the new map. Explicitly abandoned items outside the grid use **Left outside the scene** with narrative evidence. They appear in the change preview, but not in the active list, mention links or prompt, and are not carried into the next scan automatically.
- Uncertain fate of a present character's possession requires review even with automatic saving. Use **Edit map** to confirm possession, choose an existing zone, or mark an item left outside the scene. Confirmed unknown whereabouts outside the grid stop active tracking without asserting destruction or creating an archive. Unknown objects within current zones remain scene facts. Intentions are not completed actions. Legacy unknown lists are cleaned through the next scan preview even with automatic saving; the saved map is unchanged until confirmation, and the previous map remains available for rollback. Inactive entries outside the grid are excluded from injection, macros, scanning and Enhance travel context. This is scene and possession memory without an endless archive, stats, quantities or automatic actions.
- Optional `{{bb_map}}` macro for manual prompt placement.
- **Temporary effects** in Game mode describes scene, zone or character circumstances with a source and concrete end condition. They use the same map scan without another request. Applicable effects survive omission; ending requires a reported narrative event with evidence. Effects of departed scenes, zones and characters stop applying; player bodily states can follow the player. Uncertain changes require review even with automatic saving. **Edit map** can add, correct, end or remove an effect; active targets must exactly name the current scene, zone or character/player. Up to 16 records with required name, target, description, source and end condition. Effects reach injection, `{{bb_map}}` and Enhance travel context only in Game mode. Classic preserves them for returning but hides their controls and game context. Ended records do not accumulate in later scans; map rollback restores previous states. Effects do not calculate damage, penalties, rolls, player actions or message-count timers.
- Each message highlights only the first mention of each map entity. A character's full name, first name and surname share one highlight; case and supported honorifics such as "-san" do not add duplicates. Paragraphs and formatting within the message do not reset the count. Each new message gets its own highlights.
- Interface language: browser language, Russian, or English. Prompts remain in English; map descriptions follow the chat language.
- Scan source: current SillyTavern connection, a Connection Manager profile, or a direct OpenAI-compatible Custom API.
- Existing Custom API settings are preserved. Direct Custom API failures fall back to the main connection; an unavailable profile shows an error.

The two-mode map, floating widget, and light RPG features are being developed in the [`map_test` roadmap](ROADMAP.md).

## Installation

In SillyTavern, open **Extensions → Install extension** and enter:

`https://github.com/maxkara14/BB-Interactive-Map`

Reload the page. Open **Extensions settings → BB Interactive Map → Current chat map** to run the first scan.
