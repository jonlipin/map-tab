# Changelog

All notable changes to Map Tab are listed here. The newest release is at the top.

## 1.0.0 - 2026-09-26

**Map Tab is the world map half of Casement, now an addon of its own.** Casement 1.2.3 moved and
resized the world map, and it also handled the bags, the bank, the guild bank and every
character's saved bank. It is now two addons: Bank Tabs, which carries on the Casement project with
the bags and the banks, and Map Tab, this one, with everything Casement did for the world map:

- Drag the map by the clear stretches of its top bar; the game's own buttons up there are measured
  and left alone. Hold alt (or the key of your choice) to drag it from anywhere, and a gold corner
  handle appears by itself if the top bar ever has no room.
- A tab under the map, in the game's own panel art: minus, the current percentage, plus, a reset
  icon and the resize grip. The buttons walk in ten percent steps and always land on a round
  number; drag the grip for any size, hold shift to snap, double-click it for 100 percent.
- Resizing scales the whole map, so its pins and its text keep their proportions, and no drag can
  take the map off screen.
- Your coordinates and the cursor's at the left end of the tab, with a button that puts your
  position into chat with the zone name first (right-click it for a box to copy from).
- Optionally, the parts of the map you have not explored drawn in with their real art, tinted
  blue, sepia or grey, from the full overlay table for this build plus every area any character on
  the account has been shown.
- A placed map stays exactly where you left it when the quest log opens or closes.

**Your settings come with you.** At the first login with Map Tab, the world map's share of
Casement's saved data is copied across once: the map's size, position and switches for each
character (from that character's own Casement settings, the first time it logs in), and the map
areas the reveal had learned for the account. It is read from the old Casement if that is still
running, or from the small "Casement (old data)" folder Bank Tabs leaves in Casement's place,
which Map Tab loads just long enough to read it (switching it back on first if it was left
switched off, for every character or only this one). Anything already changed in Map Tab is kept,
Casement's own saved data is left as it was, and one chat line says what came over, or that
nothing needed to. If the old Casement is installed but switched off, its settings come over at
the first login it can be read, and one chat line, once per account, says how: update Casement in
the CurseForge app, where it is now Bank Tabs, or switch the old Casement on for one login. With
no Casement anywhere, Map Tab simply starts from its defaults.

**The old Casement steps aside.** If the old, whole Casement is still installed and running, Map
Tab switches it off from the next login and says so once in chat. Bank Tabs does the same, and
only one of the two says it. For that one session the old Casement keeps the world map and Map
Tab leaves the map alone, so there are never two tabs under it or two addons moving it; type
/reload to finish the switch at once. If Bank Tabs is not installed yet, the same line says to
update Casement in the CurseForge app, so the bags, bank and saved banks carry on.

**What changed from Casement**

- The command is `/maptab`. `/maptab lock` and `unlock` flip the world map switch, Map Tab's one
  on and off switch ("Move and resize the world map" in the options); locked, the map is the
  game's again, at its own size and in its own place, until it is unlocked. `/maptab reset` puts
  the map back where the game had it, at 100 percent. `scale`, `coords`, `mapdata`, `grips`,
  `window` and `debug` work as they did.
- No minimap button: the options open from `/maptab` and from Esc > Options > AddOns > Map Tab,
  on one World map page and an About page.
- Map Tab works alone and beside Bank Tabs. Both follow the game's panel positioning, and each
  only ever puts back its own windows, so neither moves the other's.

**Offline harness.** `tests/maptabtest.js` carries every world map check from Casement's harness,
and adds the data carry-over (the old data stub, reported the way the client reports a load on
demand addon, switched off for every character or only this one, refused by the game, or holding
nothing new; the old Casement running, switched off, or already told off by Bank Tabs; nothing
installed, no addon list API, already brought over, a second character, a character that never
ran Casement), Map Tab loading alone with only its own global names, a second move engine hooked
into the same panel functions, and a locked map staying the game's through the quest log and a UI
scale change. 385 checks in normal, bare and no-enum modes alike.

The world map's history before the split, Casement 1.0.0 to 1.2.3, is in the changelog of the
Casement repository, which is now Bank Tabs.
