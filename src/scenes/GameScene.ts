import Phaser from "phaser";
import { EventBus } from "../core/EventBus";
import { GameContext } from "../core/GameContext";
import { GameEvents, type GameEventMap } from "../core/events";

const FROG_DRIFT_PX_PER_SECOND = 45.22;
const WORLD_MOVEMENT_END_VIDEO_TIME = 19.95;
const CUTTER_PHASE_TWO_DURATION_SECONDS = 18;
const STORK_TARGET_DRIFT_OFFSET_PX = 10;
const FROG_PICKUP_DURATION_MS = 1200;
const FROG_SPAWN_REACTION_ALLOWANCE_MS = 800;
// This rescue window represents a fully ready fast stork and will later use fatigue/readiness.
const FROG_MIN_RESCUE_WINDOW_MS =
  FROG_SPAWN_REACTION_ALLOWANCE_MS + 900 + FROG_PICKUP_DURATION_MS;
const FROG_MIN_DISTANCE_FROM_CUTTER_PX = 135;
const FROG_SPAWN_RANDOM_ATTEMPTS = 30;
const INITIAL_FROG_COUNT = 2;
const MAX_ACTIVE_FROGS = 5;
const FROG_SPAWN_INTERVAL_MS = 3000;
const FROG_CORRIDOR_MIN_X_NORMALIZED = 0.436;
const FROG_CORRIDOR_MAX_X_NORMALIZED = 0.88;
const FROG_CORRIDOR_INNER_MARGIN_X_NORMALIZED = 0.015;
const COMBINE_CUTTER_Y_NORMALIZED = 0.62;

interface FrogSpawnPosition {
  readonly x: number;
  readonly y: number;
}

interface FrogState {
  id: number;
  readonly gameObject: Phaser.GameObjects.Arc;
  active: boolean;
  selected: boolean;
  reserved: boolean;
  rescued: boolean;
  escaped: boolean;
  pickupStork: Phaser.GameObjects.Arc | null;
  pickupTimer: Phaser.Time.TimerEvent | null;
  spawnPosition: FrogSpawnPosition;
  spawnPresentedVideoTime: number;
  spawnX: number;
  spawnY: number;
}

export class GameScene extends Phaser.Scene {
  private context: GameContext | null = null;
  private presentedVideoTime = 0;

  public constructor() {
    super("GameScene");
  }

  public create(): void {
    this.presentedVideoTime = 0;

    const events = new EventBus<GameEventMap>();
    this.context = new GameContext(this, this.game.config, events);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, this.handleShutdown, this);
    events.emit(GameEvents.APP_READY, undefined);

    this.cameras.main.setBackgroundColor("#123d2b");
    const video = this.add.video(this.scale.width / 2, this.scale.height / 2, "level-video");
    const cutterDebugLine = this.add.graphics().setDepth(0.5);
    let rescuedCount = 0;
    let escapedCount = 0;
    const debugHud = this.add
      .text(12, 12, "SAVED: 0\nESCAPED: 0", {
        color: "#ffffff",
        fontFamily: "Arial, sans-serif",
        fontSize: "20px",
      })
      .setDepth(3);
    const updateDebugHud = (): void => {
      debugHud.setText(`SAVED: ${rescuedCount}\nESCAPED: ${escapedCount}`);
    };
    const frogs: FrogState[] = Array.from({ length: MAX_ACTIVE_FROGS }, () => ({
      id: 0,
      gameObject: this.add.circle(0, 0, 18, 0x00aa44).setDepth(1).setVisible(false),
      active: false,
      selected: false,
      reserved: false,
      rescued: false,
      escaped: false,
      pickupStork: null,
      pickupTimer: null,
      spawnPosition: { x: 0, y: 0 },
      spawnPresentedVideoTime: 0,
      spawnX: 0,
      spawnY: 0,
    }));
    let selectedFrog: FrogState | null = null;
    let nextFrogId = MAX_ACTIVE_FROGS;
    let frogSpawnTimer: Phaser.Time.TimerEvent | null = null;
    let videoReady = false;
    let htmlVideoElement: HTMLVideoElement | null = null;
    let videoFrameCallbackId: number | null = null;
    let usesPresentedFrameCallback = false;
    let sceneActive = true;

    for (const frog of frogs) {
      this.tweens.add({
        targets: frog.gameObject,
        scale: 1.08,
        duration: 600,
        ease: "Sine.easeInOut",
        yoyo: true,
        repeat: -1,
      });
    }

    const getWorldOffset = (videoTime: number, spawnVideoTime: number): number => {
      const effectiveCurrentTime = Math.min(videoTime, WORLD_MOVEMENT_END_VIDEO_TIME);
      const effectiveSpawnTime = Math.min(spawnVideoTime, WORLD_MOVEMENT_END_VIDEO_TIME);
      const movingElapsedTime = Math.max(0, effectiveCurrentTime - effectiveSpawnTime);

      return movingElapsedTime * FROG_DRIFT_PX_PER_SECOND;
    };

    const getCurrentCutterYNormalized = (): number => {
      if (this.presentedVideoTime <= WORLD_MOVEMENT_END_VIDEO_TIME) {
        return COMBINE_CUTTER_Y_NORMALIZED;
      }

      const phaseTwoElapsed =
        this.presentedVideoTime - WORLD_MOVEMENT_END_VIDEO_TIME;
      const phaseTwoProgress = Phaser.Math.Clamp(
        phaseTwoElapsed / CUTTER_PHASE_TWO_DURATION_SECONDS,
        0,
        1,
      );

      return Phaser.Math.Linear(
        COMBINE_CUTTER_Y_NORMALIZED,
        0,
        phaseTwoProgress,
      );
    };

    const getCurrentCutterY = (): number => {
      const videoBounds = video.getBounds();

      return (
        videoBounds.top +
        getCurrentCutterYNormalized() * videoBounds.height
      );
    };

    const updateCutterDebugLine = (cutterY: number): void => {
      const videoBounds = video.getBounds();
      cutterDebugLine
        .clear()
        .lineStyle(2, 0xff0000, 0.55)
        .lineBetween(videoBounds.left, cutterY, videoBounds.right, cutterY);
    };

    const updateFrogBasePosition = (frog: FrogState): void => {
      const videoBounds = video.getBounds();
      const corridorLeft =
        videoBounds.left +
        videoBounds.width *
          (FROG_CORRIDOR_MIN_X_NORMALIZED + FROG_CORRIDOR_INNER_MARGIN_X_NORMALIZED);
      const corridorRight =
        videoBounds.left +
        videoBounds.width *
          (FROG_CORRIDOR_MAX_X_NORMALIZED - FROG_CORRIDOR_INNER_MARGIN_X_NORMALIZED);
      const minimumCenterX = corridorLeft + 18;
      const maximumCenterX = corridorRight - 18;
      const rawX = videoBounds.left + videoBounds.width * frog.spawnPosition.x;

      frog.spawnX =
        minimumCenterX <= maximumCenterX
          ? Phaser.Math.Clamp(rawX, minimumCenterX, maximumCenterX)
          : (corridorLeft + corridorRight) / 2;
      frog.spawnY = Phaser.Math.Clamp(
        videoBounds.top + videoBounds.height * frog.spawnPosition.y,
        videoBounds.top + 18,
        videoBounds.bottom - 18,
      );
    };

    const updateFrogPosition = (frog: FrogState): void => {
      if (!videoReady || !frog.active) {
        return;
      }

      const worldOffset = getWorldOffset(
        this.presentedVideoTime,
        frog.spawnPresentedVideoTime,
      );
      frog.gameObject.setPosition(frog.spawnX, frog.spawnY + worldOffset);
      frog.pickupStork?.setPosition(frog.gameObject.x, frog.gameObject.y);
    };

    const checkFrogEscape = (frog: FrogState, cutterY: number): void => {
      if (
        !frog.active ||
        frog.rescued ||
        frog.escaped ||
        frog.reserved ||
        frog.pickupStork !== null
      ) {
        return;
      }

      if (frog.gameObject.y < cutterY) {
        return;
      }

      frog.escaped = true;
      frog.active = false;
      frog.selected = false;
      frog.reserved = false;
      frog.pickupStork = null;
      frog.pickupTimer = null;
      frog.gameObject.setVisible(false).disableInteractive();

      if (selectedFrog === frog) {
        selectedFrog = null;
      }

      console.log("FROG_ESCAPED");
      escapedCount += 1;
      updateDebugHud();
    };

    const updateFrogs = (): void => {
      if (!usesPresentedFrameCallback && htmlVideoElement !== null) {
        this.presentedVideoTime = htmlVideoElement.currentTime;
      }

      if (!videoReady) {
        return;
      }

      const cutterY = getCurrentCutterY();
      updateCutterDebugLine(cutterY);

      for (const frog of frogs) {
        updateFrogPosition(frog);
        checkFrogEscape(frog, cutterY);
      }
    };

    const setSelectedFrog = (frog: FrogState | null): void => {
      for (const candidate of frogs) {
        candidate.selected = candidate === frog;
      }

      selectedFrog = frog;
    };

    const chooseSafeSpawnPosition = (frog: FrogState): FrogSpawnPosition | null => {
      const videoBounds = video.getBounds();
      const minimumX =
        videoBounds.left +
        videoBounds.width *
          (FROG_CORRIDOR_MIN_X_NORMALIZED + FROG_CORRIDOR_INNER_MARGIN_X_NORMALIZED) +
        18;
      const maximumX =
        videoBounds.left +
        videoBounds.width *
          (FROG_CORRIDOR_MAX_X_NORMALIZED - FROG_CORRIDOR_INNER_MARGIN_X_NORMALIZED) -
        18;
      const minimumY = videoBounds.top + 18;
      const minimumCutterClearance = Math.max(
        FROG_MIN_DISTANCE_FROM_CUTTER_PX,
        (FROG_MIN_RESCUE_WINDOW_MS / 1000) * FROG_DRIFT_PX_PER_SECOND,
      );
      const maximumY = getCurrentCutterY() - minimumCutterClearance;

      if (minimumX > maximumX || minimumY > maximumY) {
        return null;
      }

      const activeFrogs = frogs.filter((candidate) => candidate !== frog && candidate.active);

      for (let attempt = 0; attempt < FROG_SPAWN_RANDOM_ATTEMPTS; attempt += 1) {
        const candidateX = Phaser.Math.FloatBetween(minimumX, maximumX);
        const candidateY = Phaser.Math.FloatBetween(minimumY, maximumY);
        const minimumDistance = activeFrogs.reduce(
          (distance, activeFrog) =>
            Math.min(
              distance,
              Phaser.Math.Distance.Between(
                candidateX,
                candidateY,
                activeFrog.gameObject.x,
                activeFrog.gameObject.y,
              ),
            ),
          Number.POSITIVE_INFINITY,
        );

        if (minimumDistance >= 44) {
          return {
            x: (candidateX - videoBounds.left) / videoBounds.width,
            y: (candidateY - videoBounds.top) / videoBounds.height,
          };
        }
      }

      return null;
    };

    const activateFrog = (frog: FrogState): boolean => {
      const activeFrogCount = frogs.filter((candidate) => candidate.active).length;

      if (!videoReady || frog.active || activeFrogCount >= MAX_ACTIVE_FROGS) {
        return false;
      }

      const spawnPosition = chooseSafeSpawnPosition(frog);

      if (spawnPosition === null) {
        return false;
      }

      frog.id = nextFrogId;
      nextFrogId += 1;
      frog.active = true;
      frog.selected = false;
      frog.reserved = false;
      frog.rescued = false;
      frog.escaped = false;
      frog.pickupStork = null;
      frog.pickupTimer = null;
      frog.spawnPosition = spawnPosition;
      frog.spawnPresentedVideoTime = this.presentedVideoTime;
      updateFrogBasePosition(frog);
      frog.gameObject.setFillStyle(0x00aa44).setVisible(true).setInteractive();
      updateFrogPosition(frog);

      return true;
    };

    const storkLayouts = [
      { x: 0.14, y: 0.16, arrivalDuration: 900 },
      { x: 0.24, y: 0.24, arrivalDuration: 1200 },
      { x: 0.12, y: 0.34, arrivalDuration: 1500 },
    ] as const;
    const storks = storkLayouts.map(() =>
      this.add.circle(0, 0, 25, 0xffffff).setDepth(1).setInteractive(),
    );
    const homePositions = new Map<Phaser.GameObjects.Arc, Phaser.Math.Vector2>();
    const flyingStorks = new Set<Phaser.GameObjects.Arc>();
    let selectedStork: Phaser.GameObjects.Arc | null = null;

    const selectStork = (stork: Phaser.GameObjects.Arc | null): void => {
      selectedStork?.setStrokeStyle();
      selectedStork = stork;
      selectedStork?.setStrokeStyle(4, 0xffff00);
    };

    const spawnFrogIfPossible = (): void => {
      const activeFrogCount = frogs.filter((frog) => frog.active).length;

      if (activeFrogCount >= MAX_ACTIVE_FROGS) {
        return;
      }

      const inactiveFrog = frogs.find((frog) => !frog.active);

      if (inactiveFrog !== undefined) {
        activateFrog(inactiveFrog);
      }
    };

    const completeRescue = (
      frog: FrogState,
      targetFrogId: number,
      stork: Phaser.GameObjects.Arc,
    ): boolean => {
      if (
        !frog.active ||
        frog.rescued ||
        frog.escaped ||
        frog.id !== targetFrogId ||
        frog.pickupStork !== stork
      ) {
        return false;
      }

      frog.active = false;
      frog.rescued = true;
      frog.selected = false;
      frog.reserved = false;
      frog.pickupStork = null;
      frog.pickupTimer = null;
      frog.gameObject.setVisible(false).disableInteractive();

      if (selectedFrog === frog) {
        setSelectedFrog(null);
      }

      console.log("RESCUE_COMPLETE");
      rescuedCount += 1;
      updateDebugHud();

      return true;
    };

    const startPickup = (
      frog: FrogState,
      targetFrogId: number,
      stork: Phaser.GameObjects.Arc,
      beginDeparture: () => void,
    ): boolean => {
      if (
        !frog.active ||
        frog.id !== targetFrogId ||
        !frog.reserved ||
        frog.pickupStork !== null ||
        frog.pickupTimer !== null
      ) {
        return false;
      }

      frog.selected = false;

      if (selectedFrog === frog) {
        selectedFrog = null;
      }

      frog.gameObject.disableInteractive();
      frog.pickupStork = stork;
      stork.setPosition(frog.gameObject.x, frog.gameObject.y);

      frog.pickupTimer = this.time.delayedCall(FROG_PICKUP_DURATION_MS, () => {
        frog.pickupTimer = null;

        if (
          frog.id !== targetFrogId ||
          frog.pickupStork !== stork ||
          !frog.active
        ) {
          return;
        }

        completeRescue(frog, targetFrogId, stork);
        beginDeparture();
      });

      return true;
    };

    const releaseFrogReservation = (frog: FrogState, targetFrogId: number): void => {
      if (frog.active && frog.id === targetFrogId && frog.pickupStork === null) {
        frog.reserved = false;
        frog.gameObject.setInteractive();
      }
    };

    const launchStork = (stork: Phaser.GameObjects.Arc, frog: FrogState): void => {
      if (
        flyingStorks.has(stork) ||
        !frog.active ||
        frog.reserved ||
        !frog.selected
      ) {
        return;
      }

      const storkIndex = storks.indexOf(stork);
      const arrivalDuration = storkLayouts[storkIndex]?.arrivalDuration ?? 900;
      const targetFrogId = frog.id;
      const targetFrogSpawnVideoTime = frog.spawnPresentedVideoTime;
      const startPosition = new Phaser.Math.Vector2(stork.x, stork.y);
      const originalTarget = new Phaser.Math.Vector2(frog.gameObject.x, frog.gameObject.y);
      const originalTargetMarker = this.add.graphics().setDepth(2);
      const movingTargetMarker = this.add.graphics().setDepth(2);
      let flightCancelled = false;
      let debugMarkersRemoved = false;

      flyingStorks.add(stork);
      frog.reserved = true;
      frog.gameObject.disableInteractive();
      setSelectedFrog(null);
      selectStork(null);

      originalTargetMarker
        .lineStyle(2, 0xff0000)
        .lineBetween(
          originalTarget.x - 6,
          originalTarget.y - 6,
          originalTarget.x + 6,
          originalTarget.y + 6,
        )
        .lineBetween(
          originalTarget.x - 6,
          originalTarget.y + 6,
          originalTarget.x + 6,
          originalTarget.y - 6,
        );

      const drawMovingTargetMarker = (x: number, y: number): void => {
        movingTargetMarker
          .clear()
          .lineStyle(2, 0x00ffff)
          .lineBetween(x - 6, y, x + 6, y)
          .lineBetween(x, y - 6, x, y + 6);
      };

      const removeDebugMarkers = (): void => {
        if (!debugMarkersRemoved) {
          originalTargetMarker.destroy();
          movingTargetMarker.destroy();
          debugMarkersRemoved = true;
        }
      };

      this.events.once(Phaser.Scenes.Events.SHUTDOWN, removeDebugMarkers);

      const returnToStart = (): void => {
        const home = homePositions.get(stork);

        if (home !== undefined) {
          stork.setPosition(home.x, home.y);
        }

        flyingStorks.delete(stork);
        removeDebugMarkers();

        if (selectedStork === stork) {
          selectStork(null);
        }
      };

      const beginDeparture = (): void => {
        this.tweens.add({
          targets: stork,
          x: this.scale.gameSize.width + stork.displayWidth,
          y: -stork.displayHeight,
          duration: 700,
          ease: "Sine.easeIn",
          onComplete: () => {
            this.time.delayedCall(2000, returnToStart);
          },
        });
      };

      const getPredictedTarget = (remainingArrivalDuration: number): Phaser.Math.Vector2 => {
        const predictedVideoTime =
          this.presentedVideoTime + remainingArrivalDuration / 1000;
        const predictedWorldOffset = getWorldOffset(
          predictedVideoTime,
          targetFrogSpawnVideoTime,
        );

        return new Phaser.Math.Vector2(
          frog.spawnX,
          frog.spawnY + predictedWorldOffset + STORK_TARGET_DRIFT_OFFSET_PX,
        );
      };

      const cancelFlight = (): void => {
        releaseFrogReservation(frog, targetFrogId);
        returnToStart();
      };

      this.tweens.addCounter({
        from: 0,
        to: 1,
        duration: arrivalDuration,
        ease: "Sine.easeInOut",
        onUpdate: (tween) => {
          const videoBounds = video.getBounds();
          const target = getPredictedTarget(
            Math.max(0, arrivalDuration - tween.elapsed),
          );

          if (target.y > videoBounds.bottom) {
            flightCancelled = true;
            tween.stop();
            cancelFlight();
            return;
          }

          const targetX = Phaser.Math.Clamp(target.x, videoBounds.left, videoBounds.right);
          const targetY = Phaser.Math.Clamp(target.y, videoBounds.top, videoBounds.bottom);
          const progress = tween.getValue() ?? 0;

          drawMovingTargetMarker(targetX, targetY);
          stork.setPosition(
            Phaser.Math.Linear(startPosition.x, targetX, progress),
            Phaser.Math.Linear(startPosition.y, targetY, progress),
          );
        },
        onComplete: () => {
          if (flightCancelled) {
            return;
          }

          const videoBounds = video.getBounds();
          const target = getPredictedTarget(0);

          if (target.y > videoBounds.bottom) {
            cancelFlight();
            return;
          }

          stork.setPosition(
            Phaser.Math.Clamp(target.x, videoBounds.left, videoBounds.right),
            Phaser.Math.Clamp(target.y, videoBounds.top, videoBounds.bottom),
          );
          removeDebugMarkers();

          if (!startPickup(frog, targetFrogId, stork, beginDeparture)) {
            releaseFrogReservation(frog, targetFrogId);
            beginDeparture();
          }
        },
      });
    };

    for (const frog of frogs) {
      frog.gameObject.on(Phaser.Input.Events.POINTER_DOWN, () => {
        if (!frog.active || frog.reserved || frog.pickupStork !== null) {
          return;
        }

        setSelectedFrog(frog);
        const selectedFrogId = frog.id;
        frog.gameObject.setFillStyle(0xffff00);
        console.log("FROG_SELECTED");
        this.time.delayedCall(150, () => {
          if (frog.active && frog.id === selectedFrogId) {
            frog.gameObject.setFillStyle(0x00aa44);
          }
        });
      });
    }

    for (const stork of storks) {
      stork.on(Phaser.Input.Events.POINTER_DOWN, () => {
        const targetFrog = selectedFrog;

        if (
          !flyingStorks.has(stork) &&
          targetFrog !== null &&
          targetFrog.active &&
          !targetFrog.reserved &&
          targetFrog.pickupStork === null
        ) {
          selectStork(stork);
          launchStork(stork, targetFrog);
        }
      });
    }

    const resizeContent = (gameSize: Phaser.Structs.Size): void => {
      const centerX = gameSize.width / 2;
      const centerY = gameSize.height / 2;

      video.setPosition(centerX, centerY);

      if (video.width > 0 && video.height > 0) {
        const containScale = Math.min(
          gameSize.width / video.width,
          gameSize.height / video.height,
        );
        video.setScale(containScale);

        videoReady = true;

        for (const frog of frogs) {
          updateFrogBasePosition(frog);
        }

        updateFrogs();

        const videoBounds = video.getBounds();
        storks.forEach((stork, index) => {
          const layout = storkLayouts[index];
          const homeX = Phaser.Math.Clamp(
            videoBounds.left + videoBounds.width * layout.x,
            videoBounds.left + 25,
            videoBounds.right - 25,
          );
          const homeY = Phaser.Math.Clamp(
            videoBounds.top + videoBounds.height * layout.y,
            videoBounds.top + 25,
            videoBounds.bottom - 25,
          );
          const home = homePositions.get(stork);

          if (home === undefined) {
            homePositions.set(stork, new Phaser.Math.Vector2(homeX, homeY));
          } else {
            home.set(homeX, homeY);
          }

          if (!flyingStorks.has(stork)) {
            stork.setPosition(homeX, homeY);
          }
        });
      }
    };

    video.once(Phaser.GameObjects.Events.VIDEO_CREATED, () => {
      const htmlVideo = video.video;

      if (htmlVideo !== null) {
        htmlVideoElement = htmlVideo;

        if (typeof htmlVideo.requestVideoFrameCallback === "function") {
          usesPresentedFrameCallback = true;

          const requestPresentedFrame = (): void => {
            if (!sceneActive) {
              return;
            }

            videoFrameCallbackId = htmlVideo.requestVideoFrameCallback((_now, metadata) => {
              videoFrameCallbackId = null;

              if (!sceneActive) {
                return;
              }

              this.presentedVideoTime = metadata.mediaTime;
              requestPresentedFrame();
            });
          };

          requestPresentedFrame();
        }
      }

      resizeContent(this.scale.gameSize);

      for (let count = 0; count < INITIAL_FROG_COUNT; count += 1) {
        spawnFrogIfPossible();
      }

      frogSpawnTimer = this.time.addEvent({
        delay: FROG_SPAWN_INTERVAL_MS,
        loop: true,
        callback: spawnFrogIfPossible,
      });
    });
    this.scale.on(Phaser.Scale.Events.RESIZE, resizeContent);
    this.events.on(Phaser.Scenes.Events.UPDATE, updateFrogs);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      sceneActive = false;
      frogSpawnTimer?.remove(false);
      frogSpawnTimer = null;
      cutterDebugLine.destroy();
      debugHud.destroy();

      for (const frog of frogs) {
        frog.pickupTimer?.remove(false);
        frog.pickupTimer = null;
        frog.pickupStork = null;
        frog.gameObject.removeAllListeners();
        frog.gameObject.destroy();
      }

      if (
        htmlVideoElement !== null &&
        videoFrameCallbackId !== null &&
        typeof htmlVideoElement.cancelVideoFrameCallback === "function"
      ) {
        htmlVideoElement.cancelVideoFrameCallback(videoFrameCallbackId);
        videoFrameCallbackId = null;
      }

      this.scale.off(Phaser.Scale.Events.RESIZE, resizeContent);
      this.events.off(Phaser.Scenes.Events.UPDATE, updateFrogs);
    });
    video.setMute(true).play(false);
  }

  private handleShutdown(): void {
    this.context?.events.removeAllListeners();
    this.context = null;
  }
}
