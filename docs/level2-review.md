# Level 2 review

Implemented on `level1-polish`, continuing Cursor's committed checkpoints
`bba8c1e` and `1484edf`. The initial working tree was clean. Cursor's ammo,
indoor camera, UI, transition and rooftop E-door changes were retained.
Its missing `Level2.js` import is now backed by a complete residence mission.
No merge, push, history rewrite or unrelated deletion was performed.

## Files

Created:

- `src/levels/Level2.js`: residence geometry, navigation integration, resources,
  evidence, power, encounters, checkpoint, carrier and exit.
- `tests/level2.test.js`: thirteen integration/regression tests.
- `docs/level2-review.md`: this implementation and review guide.

Modified:

- `src/core/Game.js`: transition cleanup, checkpoint UI/reset, completion screen,
  reusable interior sound buffers, ambient crossfade and indoor minimap.
- `src/player/Player.js`: forward flashlight and immediate indoor camera
  obstruction handling; outdoor movement/collision/camera rules remain intact.
- `src/ui/StoryUI.js`: configurable reset objective and clue count.
- `src/weapons/Bullet.js`: recycle active visual tracers on session changes.
- `tests/story.test.js`: verify Cursor's E-to-open rooftop exit rather than
  the former automatic proximity completion.

Cursor's existing changes to `LevelManager.js`, `Level1.js`, `index.html` and
`src/styles/main.css` remain in place without further edits to those files.
No external model, texture or audio asset files were added.

## Flow and layout

The rooftop key plus a fresh E press opens the rooftop stairwell. Game fades
out, LevelManager disposes Level 1 and loads Level 2, then fades in. Health and
score carry over; the key, movement/dodge state, input, tracers and firing
cooldown reset. Level 2 starts with the indoor camera and its own objective.

The residence uses a fixed 25 by 37 cell layout with two-metre cells. The main
blue corridor and amber east corridor reconnect north and south. The common
room also connects them; the records room has a powered shortcut to the main
hall. Doorways have actual solid collision boundaries. The layout contains a
stair landing, security desk, room 201 supplies, room 203 bedroom, room 204
electrical equipment, records office, common room/kitchenette, bathrooms,
laundry and a risky storeroom. Furniture leaves traversal lanes clear.

Room signs, emergency fixtures and a cyan minimap objective marker guide the
player. The indoor minimap draws wall footprints rather than isolated dots.
Books, a laptop, academic material, disturbed papers, beds, bags, noticeboards,
blood, abandoned security clothing, pipes and electrical boxes distinguish the
rooms. All geometry, signs and floor textures are generated locally.

## Investigation and power

1. The security access log proves the service entrance, fire locks, cameras
   and rooftop access were deliberately manipulated.
2. The searched bedroom contains the exhibition photograph/note, “Always
   first,” and a marked timetable. This triggers the blackout.
3. E at the electrical controls starts a 2.4-second restoration, with lights
   coming back in sections. The records clue is unavailable until restoration.
4. The occupant record identifies the protagonist's room and tracked movements.
   It saves the checkpoint and delivers “You weren't supposed to find that.”
5. After 5.5 seconds of active gameplay, “Run.” starts the chase. Reading an
   evidence card pauses the world and this countdown.

The antagonist's identity and jealousy motive are not revealed. During the
blackout, dim ambient light, red fixtures and a forward flashlight preserve
visibility. The shortcut stays unavailable until power returns.

## Combat, resources and chase

Cursor's ammo implementation is retained: 10 loaded plus 12 reserve. The HUD
shows both. Each actual shot consumes one round; empty means no shot, sound or
flash. Reserve transfers automatically when the magazine empties, with no new
reload delay or key. **R still restarts the level.** Fire interval, hitscan,
one-shot kills, damage and explosion-chain rules are unchanged.

Fresh E pickups are fixed and one-shot, not random rewards. Following the ammo
fairness revision, the supply is:

| Source | Rounds | World position (x, z) |
| --- | ---: | --- |
| Start | 10 loaded + 12 reserve | Stair landing |
| Security entrance, critical path | 8 | -7, 6 |
| Electrical room entrance, critical path | 6 | -7, -26 |
| Records office, before the chase | 18 | 10, -8 |
| Lower stairwell emergency cache, revealed with carrier | 6 + 1 protected carrier round | 1, -29 |
| Optional room 201 supplies | 6 | -10, 18 |
| Optional risky storeroom | 8 | -12, 28 |
| Optional laundry detour | 6 | 22, -10 |
| Checkpoint retry | 10 loaded + 14 reserve | Records room |

The critical path supplies **60 ordinary rounds plus one protected round**;
optional exploration adds 20 ordinary rounds. There are 17 regular enemies
before the chase, another 3 for the optional storeroom, 30 in the chase and
one carrier. Even killing all 51 enemies separately leaves nine ordinary
rounds for misses before using the protected round or optional ammunition.
Chain explosions and avoiding fights increase that margin. Spending every
round before the records office still leaves an 18-round pre-chase pickup
and the 6-round emergency cache. A checkpoint attempt starts with 24 rounds
and restores the emergency cache, giving 30 ordinary rounds plus the carrier
reserve even if every earlier cache was collected.

The emergency cache includes **one finite protected carrier round**, displayed
separately on the ammo HUD. Ordinary ammunition is always used first. With
ordinary ammo exhausted, the reserve fires only when the existing hitscan has
a clear hit on the living carrier. A miss, wall, or intervening regular zombie
does not fire or consume it. It neither changes accuracy nor penetrates walls;
the player must obtain a clear aim. The reserve is consumed once, cannot be
refilled in an attempt, and is cleared when the carrier dies. This is an
explicit safety rule: finite ordinary pickups alone cannot prevent a player
from wasting every available round and permanently losing access to the key.

Empty trigger attempts show a short, throttled **OUT OF AMMO** banner with a
supply location hint, or instructions to aim the protected round at the carrier.
Successful pickups show the amount collected. The existing optional 30-health
pickup remains unchanged.

| Encounter | Total | Group size | Gap | Base speed |
| --- | ---: | ---: | ---: | ---: |
| First corridor | 4 | 2 | 2 s | 1.6 |
| Optional storeroom risk | 3 | 3 | 1 s | 1.65 |
| Security investigation | 6 | 3 | 2 s | 1.65 |
| Blackout silhouettes | 3 | 1 | 3.5 s | 1.55 |
| Power return | 4 | 2 | 2 s | 1.7 |
| Residence chase | 30 | 5 | 2.2 s | 1.9 |

The existing scheduler adds its existing small speed variation, enforces an
eight-metre spawn clearance, defers visible/blocked spawns, and limits regular
enemies to 32. Existing shared PursuitMap steering handles both routes and
doorways. No kill quota blocks the exit: running and using explosions to open
space are viable strategies.

The separate mobile carrier appears near the northern route, also with safe
spawn clearance. A red key tag distinguishes it. It pursues at speed 2.05,
survives other zombies' chain explosions, and dies to one direct shot. Its key
drops once and requires E. Other infected continue pursuing during collection.
E with the key opens the lower stairwell, followed by a short fade and **LEVEL
2 COMPLETE**. The ending explicitly says Level 3 is not available; no Level 3
mission or misleading full-game win is created.

## Checkpoint, sound and performance

Death after the monitored-record clue exposes Retry From Checkpoint alongside
Restart Level. Retry restores the records-room position, 100 health, 10+14
ammo, score at the checkpoint, collected evidence/resources, power and shortcut
state. It clears old enemies, carrier/key, explosions, tracers, pending messages,
input and cooldowns, then re-arms the warning/chase. It reuses the existing
residence and pools rather than loading duplicate objects.

Interior bangs, glass, growls, slams, breaker clicks and tonal cues use original
local Web Audio synthesis in the existing audio context. PCM buffers and the
gain node are cached; independent short playback sources disconnect when done.
Two reusable ambient loops crossfade rooftop wind into an interior hum.
Ambient sounds do not automatically spawn enemies. No downloads or third-party
licenses are required for these generated placeholders.

Six room lights, one red emergency light and the player's flashlight do not
cast shadows. Wall skirting uses one instanced draw call; repeated props share
box geometry. Existing zombie, explosion and tracer pools are reused. The
production bundle still produces Vite's warning for a chunk larger than
500 kB. Hardware frame rate should be checked on the actual university PCs;
headless software rendering is not a representative performance benchmark.

## Verification

- 41 tests pass: 28 existing tests plus thirteen Level 2 tests covering initialization,
  ammo/pickups, clues/power/chase, evidence pause, repeated checkpoint retries,
  carrier/chain immunity/key/exit, transition/completion, indoor camera, navigation
  through both routes and reusable sound playback. Ammo regression tests verify
  fixed critical-path pickups, unchanged optional rewards, budget versus actual
  encounter totals, empty-trigger feedback throttling, and the emergency reserve
  against misses, walls, intervening infected, successful carrier kill and exit.
- All 19 JavaScript files under `src` and `tests` pass `node --check`.
- `npm run build` passes. No lint script is configured.
- Initial implementation's local headless Chrome checks exercised the rooftop exit/Level 2 load,
  blackout and restoration, chase, first-person view, shot/chain kill, checkpoint,
  key collection and completion. Screenshots were inspected. The shot consumed
  one round and killed two infected for 800 points. Checkpoint restored health
  and cleared enemies without changing residence object count. The subsequent
  ammo revision is covered by the automated tests above; its 24-round checkpoint
  and protected carrier round still warrant a normal human playthrough.
- Chrome's audio context was running and the gunshot analyser registered a
  bounded nonzero signal. No JavaScript errors were observed during these checks.

Before presenting the game, manually play a full uninterrupted Chrome run:
try both chase routes with normal ammo usage; assess darkness on the lab monitor;
listen to sound volume and cue quality; test sprint/dodge through doorways and C
in tight corners; die and retry multiple times; verify R restarts the residence.
The automated browser checks use scripted positioning and do not replace a human
assessment of pacing, difficulty, audio quality or lab-hardware frame rate.
