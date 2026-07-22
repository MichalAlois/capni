import Phaser from "phaser";
import { EventBus } from "./EventBus";
import type { GameEventMap } from "./events";

export class GameContext {
  public readonly scene: Phaser.Scene;
  public readonly config: Phaser.Core.Config;
  public readonly events: EventBus<GameEventMap>;

  public constructor(
    scene: Phaser.Scene,
    config: Phaser.Core.Config,
    events: EventBus<GameEventMap>,
  ) {
    this.scene = scene;
    this.config = config;
    this.events = events;
  }
}
