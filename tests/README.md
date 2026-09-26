# Offline harness

`maptabtest.js` loads the addon into fengari with a stubbed WoW API and walks its main paths.
The stub carries a small layout engine (points, anchors, effective scales) because most of what
this addon does is geometry: clamping the map to the screen, holding one corner still while the
map is scaled, and putting the map back after the game has re-anchored it.

```
node tests/maptabtest.js [addon dir] [--bare] [--verbose] [--noenum]
```

- no flags: 309 checks against the normal client
- `--bare`: every UI template is missing, so every fallback path runs (309 checks)
- `--noenum`: no `Enum.BagIndex`, which Map Tab never reads (309 checks)
- `--verbose`: prints everything the addon puts in the chat frame, and each scenario's tally

The addon directory defaults to the repository the script sits in.

Each scenario runs in a fresh Lua state:

- a clean install, the long walk through every feature, which also proves Map Tab loads alone,
  adds no global name that is not its own, and leaves the bags, the bank and the minimap to Bank
  Tabs, even with a second move engine hooked into the same panel functions;
- Casement's old data stub present, loaded on demand at login and its world map share copied over;
- the old Casement still running, switched off for the next session with one chat line;
- the old Casement running beside Bank Tabs, which tells the user instead;
- nothing installed, on a client whose addon list errors on an unknown name;
- no addon list API at all;
- already brought over at an earlier login;
- a second character, whose own settings still come over;
- a character that never ran Casement, which gets Casement's account copy without a position.

It needs `fengari` on the module path; the copy this was developed against is not checked in.
