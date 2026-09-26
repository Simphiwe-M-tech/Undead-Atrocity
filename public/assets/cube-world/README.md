These models are copied from the project's Cube_World_Kit by Quaternius.
The glTF files include their geometry and atlas images, with no external
texture dependencies. Only the game's selected assets are shipped here.

- Blocks: Brick, GreyBricks, Stone, Metal, WoodPlanks, Grass, Crate
- Environment: Bush, Flowers_2, Tree_2, Plant_2
- Player: Character_Male_1, with its original atlas, skeleton, and animations
- Regular infected: Zombie, Goblin, Demon, with their original atlases, rigs, and animations
- Janitor and key carrier: Giant, with its original atlas, rig, and animations

Runtime loading and normalization: src/utils/CubeWorldKit.js
Rooftop placement: src/levels/RooftopArt.js
Player animation and fitting: src/player/KitCharacter.js
Shared infected models and animations: src/enemies/ZombieKit.js
