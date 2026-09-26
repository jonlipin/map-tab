# Map Tab

Map Tab puts a small tab under the world map that moves and resizes it. Drag the map by its top
bar, size it from the tab in round ten percent steps or freely with a grip, read your coordinates
and the cursor's, put your position into chat with one click, and, if you like, see the parts of
the map you have not explored yet.

Everything is a switch in **Esc > Options > AddOns > Map Tab**, or `/maptab`.

Map Tab is the world map half of what used to be Casement. The bags, bank, guild bank and saved
bank half is Bank Tabs, a separate download.

## What it does

**Moving the map**

- Drag it by its top bar, anywhere along it. The game's own buttons up there are measured and left
  alone, so the bar is only draggable in the stretches nothing else is using.
- Hold alt (or shift, or ctrl, or nothing, your choice) and you can drag the map from anywhere on
  it, which helps when its top bar is busy.
- A gold handle in the top left corner appears by itself if the top bar ever has no room to spare,
  and can be switched on permanently.
- No drag can take the map off screen. It is clamped while you drag it, when the position is
  saved, and again if you change your resolution or UI scale.
- A placed map stays exactly where you left it when the quest log opens or closes, and the game
  showing the map again does not undo your placing. The position is remembered per character.

**Resizing it from the tab**

- Everything Map Tab adds lives in a tab under the map, wearing the game's own panel art, so
  nothing is laid over the map's interface: minus, the current percentage, plus, a button back to
  100 percent, and the resize grip (the same grabber the chat windows use).
- The buttons always land on a round multiple of the step, so repeated clicks walk 90, 100, 110
  even if a drag left you on 97. Drag the grip for any size; hold shift while you drag to snap to
  the step; double-click it for 100 percent.
- Resizing scales the whole map rather than stretching the frame. Everything on it, the pins, the
  zone art and the text, keeps its proportions. The tab itself stays the same size on screen.
- The tab flips above the map if the map is sitting at the bottom of the screen.

**Coordinates**

- Your position and, on a second line, where the cursor is pointing on the map, at the left end of
  the tab, as hundredths of the map the way every coordinate addon prints them.
- A button next to them puts your position into chat with the zone name first ("The Barrens 45.2,
  67.8"), into whatever you are already typing if a chat line is open; right-click it for a box to
  copy the text out of with Ctrl+C.

**The fog reveal**

- Optionally, the parts of the map you have not explored are drawn in with their real art, tinted
  blue, sepia or grey so they can still be told apart. Off by default.
- The list of every map's overlays ships with the addon (`Data/MapOverlays.lua`, generated from
  the client's own map tables by `tools/overlays-from-csv.js`), and everything any character on
  this account is handed is remembered on top of it, so a patch that adds an area is picked up as
  soon as anyone sees it. `/maptab mapdata` says how much of the open map is known.

## Coming from Casement

At your first login with Map Tab, the world map's share of Casement's saved data is copied across
once: the map's size, position and switches for each character, and the map areas the reveal had
learned for the account. Anything you have already changed in Map Tab is kept, and Casement's own
saved data is left as it was. One chat line says what came over.

The data is read from the old Casement if it is still installed and running, or from the small
"Casement (old data)" folder that Bank Tabs leaves in Casement's place. If the old, whole Casement
is still running, it is switched off from your next login so it stops handling the map beside Map
Tab; type `/reload` to finish the switch at once.

Map Tab works on its own, and beside Bank Tabs: both follow the game's panel positioning, and each
only ever puts back its own windows.

## Commands

| Command | What it does |
| --- | --- |
| `/maptab` | Opens the options |
| `/maptab window` | Opens the options in a window of their own |
| `/maptab scale 120` | Sets the world map size, 50 to 200 percent |
| `/maptab reset` | Puts the map back where the game had it, at 100 percent |
| `/maptab lock` / `unlock` | Turns the world map switch off or on |
| `/maptab coords` | Puts your coordinates in a box to copy |
| `/maptab mapdata` | Reports how much of the shown map the reveal knows; `dump` opens all of it |
| `/maptab grips` | Outlines the parts of the map you can drag |
| `/maptab debug` | Prints what resolved on this client |

## Source and issues

https://github.com/jonlipin/map-tab

## If something does not work

Run `/maptab debug` and send the output. Every part of the addon probes the client before it uses
it, and the report says what it found: whether the map was found, how many draggable stretches its
top bar gave up, what layer the tab reached, how many times the resize grip has been pressed, which
templates resolved, what the reveal knows, and whether any Casement data was brought over.

## Building and testing

`tests/maptabtest.js` is an offline harness. It stubs the game API in fengari, including a small
layout engine for points, anchors and scales, and walks the addon's main paths: clamping, dragging,
scaling, snapping, the tab, the coordinates, the reveal and the options. It builds a stand in for
the quest panel, so the layering the resize grip needs is asserted rather than assumed, and runs a
second move engine on the same panel hooks to prove the two leave each other's windows alone. Each
way Casement's data can be waiting at the first login runs in a fresh Lua state of its own.

```
node tests/maptabtest.js              # 309 checks
node tests/maptabtest.js --bare       # every UI template missing
node tests/maptabtest.js --noenum     # no Enum.BagIndex
```

It needs `fengari` on the module path.

## License

MIT.
