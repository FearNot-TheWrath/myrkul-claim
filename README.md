# Myrkul's Claim

A manual soul tracking module for Foundry VTT, designed for a Paladin who has made a pact with Myrkul, the Lord of Bones. Track Soul Fragments, spend them for dark boons, and bear the weight of corruption.

The module is intentionally **manual only**. It does not modify your sheet, automate damage, or apply Active Effects. It tracks two numbers (souls and corruption), reveals corruption milestones as you cross them, and prints chat reminders of what each boon does. The player handles the actual mechanical effects on their sheet.

## Features

* **Soul Fragments** capped by the pact actor's proficiency bonus.
* **Three boons** spendable for one soul each:
  * **Dark Boon:** temp HP equal to Paladin level.
  * **Whispers of Death:** +1d4 necrotic on one attack.
  * **Reaper's Focus:** advantage on one save vs fear, charm, or necrotic.
* **Corruption** increases by 1 every time a soul is spent. Three revealed milestones at 10, 25, and 50.
* **Pact Panel** for the actor's owner or the GM to manage souls, corruption, and toggle the pact.
* **Sheet widget** injected into the dnd5e character sheet of the pact actor.
* **Floating HUD widget** for quick boon access.
* **Chat commands** for everything (see below).
* **Public API** on `game.modules.get("myrkul-claim").api` for macros.

## Installation

In Foundry's Add on Modules screen, paste this manifest URL:

```
https://github.com/FearNot-TheWrath/myrkul-claim/releases/latest/download/module.json
```

Then enable **Myrkul's Claim** in your world's module settings.

## Setup

1. Open the Pact Panel: type `!soul` in chat, or run the API call `game.modules.get("myrkul-claim").api.openPanel()`.
2. Select the **Pact Actor** from the dropdown. Only player characters are listed.
3. The pact starts enabled. Click **Disable Pact** to suspend tracking without losing data.

## Chat Commands

All commands are prefixed with `!soul`.

| Command | Effect |
| --- | --- |
| `!soul` or `!soul panel` | Open the Pact Panel (owner or GM only) |
| `!soul add [n]` | Add n soul fragments (default 1, capped by proficiency) |
| `!soul spend <boon\|whispers\|focus>` | Spend a soul for a boon. Corruption +1 |
| `!soul clear` | Set souls to 0 |
| `!soul reset` | Set souls AND corruption to 0 |
| `!soul dec [n]` | Decrease corruption by n |
| `!soul help` | Show this list in chat |

## Macro API

```js
const api = game.modules.get("myrkul-claim").api;

api.addSoul(actorId, amount);            // amount defaults to 1
api.spendSoul(actorId, "darkBoon");      // or "whispers", "focus"
api.decreaseCorruption(actorId, amount); // amount defaults to 1
api.resetCorruption(actorId);
api.openPanel();
```

Pass `null` for `actorId` to act on the configured pact actor.

## Compatibility

* **Foundry VTT:** v11.315 minimum, verified on v13.
* **System:** dnd5e (Paladin level is read from `actor.system.classes.paladin`).
* **Optional integrations:** midi qol, dae, itemacro, sequencer. None are required.

## Corruption Milestones

Milestones surface in the Pact Panel only after the threshold is reached.

* **10:** Your eyes flash pale with Myrkul's fire.
* **25:** Myrkul whispers more frequently, pushing his agenda.
* **50:** You risk becoming Myrkul's Exarch unless something intervenes.

## Compendium

`Myrkul's Claim Items` is included as a system compendium. Drag items onto your sheet as needed.

## License

See `LICENSE`.
