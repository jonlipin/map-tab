# Offline harness

`maptabtest.js` loads the addon into fengari with a stubbed WoW API and walks its main paths.
The stub carries a small layout engine (points, anchors, effective scales) because most of what
this addon does is geometry: clamping the map to the screen, holding one corner still while the
map is scaled, and putting the map back after the game has re-anchored it.

```
node tests/maptabtest.js [addon dir] [--bare] [--verbose] [--noenum]
```

- no flags: 457 checks against the normal client
- `--bare`: every UI template is missing, so every fallback path runs (457 checks)
- `--noenum`: no `Enum.BagIndex`, which Map Tab never reads (457 checks)
- `--verbose`: prints everything the addon puts in the chat frame, and each scenario's tally

The addon directory defaults to the repository the script sits in.

Each scenario runs in a fresh Lua state:

- a clean install, the long walk through every feature, which also proves Map Tab loads alone,
  adds no global name that is not its own, and leaves the bags, the bank and the minimap to Bank
  Tabs, even with a second move engine hooked into the same panel functions; it also locks the map
  (and switches the saved master switch off) with a saved spot and proves the map stays the
  game's through the quest log, a UI scale change and a size set while locked, and that the map
  switch is the page's only on and off switch, keeps the map's saved spot and size when switched
  off on the page just as `/maptab lock` does, and follows the size slider as it moves;
- Casement's old data stub present, reported the way the client reports a load on demand addon
  that is not loaded yet (not loadable, reason `DEMAND_LOADED`), loaded on demand at login and its
  world map share copied over; and the same stub reported loadable, the other reading;
- the old Casement still running, switched off for the next session with one chat line (which
  says where Bank Tabs comes from when it is not installed) and the shared
  `CASEMENT_REPLACED_NOTICE` mark set, so Bank Tabs coming second stays quiet, and the account
  remembering that the notice switched it off; Map Tab leaves the world map to it for that
  session: no tab, no hooks placing the map, its scale untouched; and at logout what the user did
  to the map in the old addon since login (size, spot, switches, learned areas) comes over, but
  never over a setting changed in Map Tab meanwhile;
- the old Casement running, with the map's spot forgotten in it: forgotten here too at logout;
- the old Casement running again on a character already brought over: nothing followed at logout;
- the old Casement running when Bank Tabs got to it first: Map Tab says nothing and switches
  nothing off, but still brings its own half over and remembers the notice switched it off; and
  when Map Tab gets there first beside an installed Bank Tabs;
- the old Casement installed but switched off: never switched on or loaded, nothing marked done,
  one chat line per account saying how to make it readable, and everything comes over at the one
  login it runs;
- the old Casement switched off by the notice, before a later character: nothing said, the
  question left open; then updated to the data stub, still off from the notice, which is
  switched on and read once, and the notice's mark cleared;
- the data stub switched off for every character, or for this character only (with and without
  an enable state to ask), while the account's share is still to come over: it runs no code, so
  it is switched on to be read;
- the data stub switched off after the account's share came over, for every character, or for
  this character only with no enable state to ask: the user's doing, so it is left off without a
  word and read if it is switched on again;
- the data stub left switched off by the notice, before a later character: switched on and read
  without a word; switched off by the user after that, it is left off;
- the data stub switched on, but with an enable state that reads 0 for this character, after the
  account's share came over: LoadAddOn decides, and it is read;
- the data stub the game refuses to load: tried again at every login, one chat line per account;
- the data stub holding nothing new: the first import still says so in one line;
- nothing installed, on a client whose addon list errors on an unknown name;
- nothing installed at first, then the data stub turns up (Bank Tabs installed afterwards): the
  clean login only notes "none", and the next login brings the map's share over, once;
- no addon list API at all;
- already brought over at an earlier login;
- a second character, whose own Casement settings replace the account copy it adopted, except
  where Casement only filled in its default;
- a character that never ran Casement, which gets Casement's account copy without a position.

It needs `fengari` on the module path; the copy this was developed against is not checked in.
