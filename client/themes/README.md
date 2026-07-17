# Themes

A theme decides what the app looks like, how it opens, and which interface it runs on.

```
client/themes/<name>/theme.json
client/themes/<name>/assets/…
```

## canabolabs is the base — allaroundme is the default

Two different jobs, easy to conflate:

- **`allaroundme`** is what loads when nobody asked for anything. The product's own brand.
- **`canabolabs`** is what every theme is deep-merged **on top of**. Anything a theme leaves out —
  an asset, a colour, the open screen, the favicon — resolves to canabolabs' value. That is what
  lets `seach` be a few lines long, and it is why **canabolabs must stay complete**: it is the only
  theme with nothing to fall back to.

Merging is per key, all the way down. Arrays and scalars replace rather than combine.

`null` is a value, not an omission — it is how a theme says "not this":

```json
{ "openScreen": { "background": null } }
```

means *no background image* (a plain backdrop), rather than inheriting canabolabs' artwork. Same
for `"logo": null` when the background image is already the finished card.

## Picking one

`?theme=<name>` (remembered in localStorage) → localStorage → `allaroundme`.
`?ui=1|2` overrides the interface type for one visit without changing brand.

## Fields

| Field | Meaning |
| --- | --- |
| `ui.type` | `1` = the built-in radial map over OSM tiles · `2` = `google_based` (Google Maps JS API). The deployment's `UI_TYPE` overrides this; `?ui=` overrides both |
| `openScreen.animation` | which `client/animations/<id>.json` plays on entry |
| `openScreen.*` | anything else here overrides that animation's own fields for this theme |
| `assets.*` | named assets. Animations ask for `background` / `logo` by **name**, never by path — which is how one animation serves every brand |
| `assets.favicon` | the tab icon; `theme.js` swaps `rel=icon` to it on load |
| `colors.*` | `ink`, `accent`, `backdrop` (`backdrop` is painted under every open screen) |

## Adding a brand

1. `mkdir -p client/themes/<name>/assets` and drop in `background` + `logo`.
   The logo wants a transparent background: the open screen composites it straight onto the
   background image. SVG or PNG both work; the demo files are SVG placeholders.
2. Write `theme.json` with only what differs from canabolabs — usually `name`, `label`, `assets`.
3. Nudge the logo with `openScreen.logo` if the default placement does not suit the artwork:

```json
{
  "openScreen": { "logo": { "x": "50%", "y": "38%", "width": "70%" } }
}
```

`x`/`y` place the logo's **centre**; `width` is relative to the screen. Any CSS length works.

## `ui.type = 2`

Needs a Google Maps browser key — `GOOGLE_MAPS_BROWSER_KEY` in `.env.credentials`, served to the
page by `/api/config`. Without it the theme falls back to the built-in map and says so in the map
subtitle, rather than showing a map screen with no map.
