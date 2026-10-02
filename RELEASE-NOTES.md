## 1.1.0 - 2026-10-01

**New: zone level ranges on the continent map.** Point at a zone on the continent map and its
level range now follows its name in the label at the top of the map, for example Westfall
(10-20), coloured by how hard the zone is for you: red or orange while it is above you, yellow
while you are inside it, green or grey once you have outgrown it. The game's own map label does
exactly this for zones it knows the levels of, but on this client it knows none (no zone in build
1.60.1.70170 carries level data), so Map Tab supplies the numbers: every zone on Kalimdor and the
Eastern Kingdoms, plus the WoW: Forever zones Zephras Isle (1-12), Riverglades (35-45) and Mount
Hyjal (60). The cities and Moonglade have no range, and Shen'dralas has none until its range is
known. It is on by default, with its own switch on the World map page, and it goes off with the
rest of Map Tab when the map is locked. Map Tab only adds to the label's text after the game has
written it, so if a later build gives the game its own numbers, the game's text is left alone.

**Checked: the new game build.** The fog reveal's map data, regenerated from the client tables of
build 1.60.1.70170, is identical to what 1.0.0 shipped for 1.60.1.70009, so the reveal needs no
update.

**Changed: the note at the top of the World map options page.** It no longer says that everything
Map Tab adds lives in the tab, or that a maximized map is left alone. It now says that the controls
live in the tab, and that while the map is maximized its size and the tab are left alone.

496 checks in normal, bare and no-enum modes alike.
