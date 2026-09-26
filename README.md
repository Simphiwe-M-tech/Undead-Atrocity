# Maze Zombies

A Minecraft-style zombie shooter set in a maze. Built with Three.js.

## Gameplay

Navigate the maze, shoot zombies with your gun, find the **janitor zombie** and kill it to get the **key**, then use the key to unlock the **exit door** and escape!

### Mechanics

- **3-Hit System**: Zombies take 3 bullets to kill. On the 3rd hit they **explode** into blocky debris.
- **Chain Explosions**: If another zombie is within the explosion radius, they die instantly from the blast - creating potential chain reactions!
- **Janitor Zombie**: One zombie wears a blue cap and name badge. Killing it drops the key needed to escape.
- **Exit Door**: Find the exit door at the edge of the maze. You need the key to open it and clear the level.

## Controls

| Key | Action |
|-----|--------|
| WASD | Move |
| Mouse | Look / Aim |
| Left Click | Shoot |
| Shift | Sprint |
| Space | Dodge Roll |
| C | Toggle Camera (1st/3rd person) |
| R | Restart Level |
| Esc | Pause |

## Running Locally

```bash
npm install
npm run dev
```

Then open http://localhost:3000 in your browser.

## Tech Stack

- [Three.js](https://threejs.org/) - 3D rendering
- [Vite](https://vitejs.dev/) - Build tool and dev server

## Credits

Player and zombie characters, rooftop blocks, plants, and flowers from **Cube World Kit** by **Quaternius**.

Based on [Thesis of the Dead](https://github.com/Taup178/Thesis_of_the_dead)
