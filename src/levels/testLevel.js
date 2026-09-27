import { tileCenter } from '../world/Tilemap.js';

// Placeholder level until Phase 4's JSON level format replaces it.
const DOWN = Math.PI / 2;
const LEFT = Math.PI;
const waypoint = (tx, ty, extra = {}) => ({ ...tileCenter(tx, ty), ...extra });

export const testLevel = {
  spawn: tileCenter(3, 3),
  guards: [
    { route: 'pingpong', patrol: [waypoint(6, 13, { wait: 1.5 }), waypoint(18, 13, { wait: 1.5 })] },
    {
      route: 'loop',
      patrol: [
        waypoint(18, 14, { wait: 0.5 }),
        waypoint(24, 14, { wait: 0.5 }),
        waypoint(24, 21, { wait: 0.5 }),
        waypoint(18, 21, { wait: 0.5 }),
      ],
    },
    {
      route: 'loop',
      patrol: [waypoint(33, 12, { wait: 2.5, look: DOWN }), waypoint(33, 12, { wait: 2.5, look: LEFT })],
    },
    {
      route: 'loop',
      patrol: [
        waypoint(30, 30, { wait: 1 }),
        waypoint(50, 30, { wait: 1 }),
        waypoint(50, 35, { wait: 1 }),
        waypoint(30, 35, { wait: 1 }),
      ],
    },
    { route: 'pingpong', patrol: [waypoint(49, 4, { wait: 1 }), waypoint(49, 20, { wait: 1 })] },
  ],
};
