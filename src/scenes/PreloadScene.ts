import Phaser from "phaser";

export class PreloadScene extends Phaser.Scene {
  public constructor() {
    super("PreloadScene");
  }

  public preload(): void {
    this.load.video("level-video", "/assets/video/kombajn_v1.mp4", true);
  }

  public create(): void {
    this.scene.start("GameScene");
  }
}
