# Local topology format (v3)

This is the data foundation for the approved places-and-passages map. The full-map
renderer and change preview can display validated v3 data. Live generation, editing,
the widget and travel controls still use the v2 grid until their integration is ready.
Extension release versions are separate from this format.

## Saved envelope

`{ version: 3, raw, context, previous }` keeps the existing envelope and one rollback
snapshot. `previous` preserves its own version, raw data and context. Reading through
`readMapState` creates a validated view without writing chat metadata. Versions 1/2
remain grid views; reading them does not invent passages from compass positions.
Unsupported saved versions fail validation.

## Candidate and canonical raw data

```json
{
  "layout": "graph",
  "scope": "scene",
  "schematic_name": "Butterfly Estate",
  "atmosphere": "Warm afternoon",
  "player_place_id": "hall",
  "zones": [
    {
      "id": "hall",
      "name": "Training Hall",
      "kind": "room",
      "summary": "A cedar training floor.",
      "threat_level": "tension",
      "threat_reason": "Contact sparring is underway.",
      "poi": [],
      "characters": [],
      "uncertain": false
    },
    {
      "id": "garden",
      "name": "Garden",
      "kind": "outdoor",
      "summary": "A gravel path among wisteria beds."
    }
  ],
  "connections": [
    {
      "from": "hall",
      "to": "garden",
      "name": "Open shoji",
      "kind": "opening",
      "status": "confirmed",
      "direction": "both",
      "evidence": "The player saw the garden through the opened shoji."
    }
  ]
}
```

`normalizeGraphMapData(candidate, previousRaw)` validates and returns canonical data:

- `scope`: `scene` or `surroundings`.
- `zones`: 1–24 places. Existing zone contents (`poi`, `characters`, threat fields)
  retain their current normalization and entity identity rules. `position` is absent.
- Place `kind`: `room`, `outdoor`, `passage`, `area`, `unknown`. These are semantic
  types; they do not assert a room's shape, dimensions or exact coordinates.
- Candidate place IDs: unique ASCII identifiers, 1–64 characters, starting with a
  letter/digit and otherwise containing letters, digits, hyphens or underscores.
  The application assigns `bbp-N` IDs and remaps all references. Prior explicit IDs
  retain identity; unique names within the same scene can retain identity when the
  model changes response keys. Repeated names are not matched by name alone.
- `player_place_id`: a candidate place ID, or explicit `null` when position is
  unknown. No default center or first-place fallback.
- `connections`: 0–48 records. Both endpoints must exist and differ. One connection
  per endpoint pair/direction; reversed bidirectional duplicates are rejected.
- Connection `kind`: `door`, `path`, `stairs`, `opening`, `passage`, `unknown`.
- Connection `status`: `confirmed`, `uncertain`, `blocked`.
- `direction`: `both` by default, or `forward` (from → to).
- `name` is required. Nonempty `evidence` is required for confirmed/blocked links;
  uncertain links can have no established evidence. A valid structure does not
  independently prove the model's narrative claim.
- Place names, summaries, threat reasons, connection names/evidence, scene name and
  atmosphere have a 1500-character ceiling. Existing entity/effect limits still apply.
- Canonical connections receive `bbc-N` IDs matched by endpoint pair/direction.
  All stored record IDs are validated as unique during graph reading. Resolved IDs
  of repeated objects/characters are preserved on read, rather than reassigned.
- Existing `unlocated_objects`, `object_memory_scope` and `effects` remain supported.
  Zone-scoped effects still target the exact place name. Possession and effect
  reconciliation operate on the existing `zones` collection.

## Routes and context

`getMapRoute(raw, destinationId)` returns `{ places: [ids], connections: [ids] }`
for the shortest route by number of confirmed passages, respecting direction. It
returns `null` for unknown position, nonexistent/unreachable destinations or grid
data. It does not change player position, estimate distance/time, traverse blocked
or uncertain links, or add connections. Disconnected places remain valid facts;
an absent connection means unknown connectivity, not a proven barrier.

`buildMapContextString` includes every graph place, the explicit/unknown player
position, passage status, direction and evidence. Game-only effects are appended
through the existing separate context function. `createSavedMap` selects envelope
version 3 for graphs and version 2 for grids; `restorePreviousMap` can switch between
them without converting either snapshot.

## Next integration gates

Before enabling graph scans in the live UI, adapt topology change review and
uncertainty gates, the editor, widget, mention links, travel context and
Enhance bridge. Layout is derived by the extension; the model supplies semantic
places and established links. Old grids stay readable throughout this work.

`createMapTopologyView` renders the graph using native place buttons, typed outlines,
direction/status marks and a selection card. Routes highlight only confirmed edges;
selection does not change saved data. Layout responds to container width, and passage
lines detour around intervening places. Names rotate parallel to a visible segment;
short or colliding labels remain available in the selected place's passage details.
Full-map observers are disconnected when the window closes or the chat/mode changes.
The v3 preview compares places, passage facts, player position and entity movement.
