import Phaser from "phaser";

export class PreloadScene extends Phaser.Scene {
  public constructor() {
    super("PreloadScene");
  }

  public preload(): void {
    this.load.video(
      "level-video",
      `${import.meta.env.BASE_URL}assets/video/kombajn_v2.mp4`,
      true,
    );
  }

  public create(): void {
    this.scene.start("GameScene");
  }
}
