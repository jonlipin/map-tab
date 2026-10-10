## 1.2.0 - 2026-10-10

**New: window styles, with a Dark look built in.** A new Look page in the options picks how Map
Tab draws its own pieces: the tab under the map, the options window and the copy box.

- **Automatic**, the default, matches EllesmereUI when it is installed and keeps the game's look
  otherwise.
- **Blizzard** keeps the game's own panel art.
- **Dark** is a flat dark style built into Map Tab that needs no other addon: a dark backdrop with
  thin edges, flat plus and minus buttons, square reset and copy icons, and a title strip on the
  options window and the copy box.
- A **Dark background opacity** slider (0 to 100%, in steps of 5) sets how much of the world shows
  through the Dark windows, and they change as you drag it. It is grayed out unless Dark is
  chosen.
- `/maptab style auto`, `blizzard` or `dark` picks a style from chat; `/maptab style` on its own
  steps to the next one.
- Going from Blizzard to another style draws it at once. Leaving a drawn style takes a reload of
  the interface, and a small window offers one (Reload now or Later). It goes away again if you
  change your mind back.
- The world map itself, its zone and level labels and the map art the reveal paints in keep the
  look the game (or EllesmereUI) gives them. So do the resize grip, which keeps the game's
  grabber, the dividers in the tab, and the options controls, which show in the game's own options
  panel too.
- Resetting every setting puts the style back to Automatic. `/maptab debug` has a "skin" line
  saying which look is in use, and why when it is not the one you expected.

**New: EllesmereUI support.** With EllesmereUI installed and its Blizzard Skins+ module on,
Automatic gives the tab, the options window and the copy box EllesmereUI's look, its font
included. It can be switched off for Map Tab in EllesmereUI's own options, under Blizzard Skins+ >
Window Skins > Third-Party Addons (takes a reload). Without EllesmereUI nothing changes: it is
optional, not a requirement.

**Fixed: the X on Map Tab's windows did nothing in combat.** In combat, the close button of the
options window or the copy box gave "Interface action blocked". The X now closes its window in
combat too.

**American spelling.** The reveal's tint is now called Gray, and the options and notes say color
and gray. A gray tint saved by an earlier Map Tab, or brought over from Casement, carries over as
Gray.

615 checks in normal and no-enum modes, 610 with every UI template missing.
