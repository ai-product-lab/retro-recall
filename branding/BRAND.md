# Brand

## Name

**Retro Recall** — recommended and adopted as the arcade/site name.

It works on three levels: *recall* as nostalgia (you remember these games), *recall* as remake (we're calling them back into service), and *recall* as the project's promise (we document everything so you can recall how it was done). Alliterative, easy to say, kid-friendly, and the .com-adjacent domains (retrorecall.games, playretrorecall.com) are plausible. Run a trademark search before public launch (ADR-005 checklist).

Candidates considered: Replay Arcade (flat), Pixel Kin (nice family angle, weak game connotation), NewGame+ (clever, unsearchable), Couch & Cloud (describes the feature, not the feeling).

**First game: Bubble Buddies.** "Buddies" carries both the co-op promise and the avatar feature — your buddies literally become the characters. Sub-brand pattern for future games: alliterative two-word names with a friendly noun (e.g., a maze-chase variant might be *Maze Mates*).

**Avatar feature: "Get Sprited."** Verb-able, ownable, explains itself ("Sprite me!").

## Tagline

**"Old games. New players."** — the players are new in both senses: new generation, and you-as-the-character.
Alternate for the Field Guide: *"Watch us build it. Then build your own."*

## Voice

Warm arcade-attendant, not ironic retro-bro. We're a parent showing kids something cool, and an engineer showing peers how it works. Short sentences. Excitement over hype. Never "EPIC." Field Guide voice is candid: we show failures and costs, not just wins.

## Visual identity

The aesthetic is **"CRT glow in a modern room"**: NES-era pixel art presented with generous modern spacing — pixel-perfect game art, clean contemporary UI around it. Never fake-degrade the UI (no scanline filters on text).

### Palette

| Role | Color | Hex |
|---|---|---|
| Midnight (background) | deep navy-black | `#0F1222` |
| Phosphor (primary accent) | mint-green glow | `#3DF5A6` |
| Bubble (secondary) | sky cyan | `#4CC9F0` |
| Cabinet (warm accent) | sunset coral | `#FF6B6B` |
| Star (highlight) | arcade yellow | `#FFD166` |
| Paper (text on dark) | warm off-white | `#F2EFE9` |

Game sprites use a constrained 16-color house palette derived from these (defined in `retrokit` as `PALETTE_P1`), which is also what avatar generation quantizes to — everything on screen automatically matches.

### Typography

Display/logo: a pixel font (e.g., self-hosted "Press Start 2P"-class face, license-checked) used sparingly — headlines and game titles only. Body/UI: a clean modern sans (system stack or Inter). Code in the Field Guide: JetBrains Mono.

### Logo

Wordmark: "RETRO RECALL" in pixel type with the second R's counter replaced by a pixel bubble — the bubble motif ties the brand to game #1 and reads as a "rewind/recall" ball. See `branding/logo.svg`. Favicon: the pixel bubble alone.

### Motion

UI animation is allowed exactly one indulgence: things may *pop* (scale-bounce) like a bubble. Everything else is instant or fast-fade. Games themselves run at 60fps, always.

## Usage rules

Never use Nintendo/Taito trade dress, fonts, or color schemes traceable to specific games (ADR-005). The brand says "inspired by the classics"; it never names them in shipped product or marketing.
