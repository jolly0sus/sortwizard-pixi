import { Ball } from "./Ball.js";

export function spawnFreeBall(
  world,
  { x, y, color, vx = 0, vy = 0, alreadyMultiplied = false, laneX = null },
) {
  const ball = Ball.spawn(world.ballLayer);
  ball.setColor(
    color,
    world.textures.ball[color],
    world.textures.ballLit[color],
  );
  ball.x = x;
  ball.y = y;
  ball.freeFalling = true;
  ball.vx = vx;
  ball.vy = vy;
  ball.alreadyMultiplied = alreadyMultiplied;
  ball.laneX = laneX;
  world.freeBalls.add(ball);
  world.conveyor.registerFreeBall(ball);
  return ball;
}
