import Phaser from "phaser";
import { EventBus } from "../core/EventBus";
import { GameContext } from "../core/GameContext";
import { GameEvents, type GameEventMap } from "../core/events";
import {
  CUTTER_TRACK_SAMPLES,
  TRACTOR_FRONT_TRACK_SAMPLES,
  TRAILER_BOTTOM_RIGHT_SAMPLES,
  TRAILER_TRACK_SAMPLES,
  type CutterTrackSample,
  type TractorFrontTrackSample,
  type TrailerCornerSample,
} from "../data/videoTracks";

let FROG_DRIFT_PX_PER_SECOND = 45.22;
let WORLD_MOVEMENT_END_VIDEO_TIME = 19.95;
const CUTTER_PHASE_TWO_DURATION_SECONDS = 18;
const STORK_TARGET_DRIFT_OFFSET_PX = 10;
const STORK_PICKUP_DURATION_MIN_MS = 1200;
const STORK_PICKUP_DURATION_MAX_MS = 2400;
const STORK_ABORT_MARGIN_MIN_PX = 5;
const STORK_ABORT_MARGIN_MAX_PX = 30;
let CUTTER_ABORT_MARGIN_PX = 25;
const FROG_SPAWN_REACTION_ALLOWANCE_MS = 800;
// This rescue window represents a fully ready fast stork and will later use fatigue/readiness.
const FROG_MIN_RESCUE_WINDOW_MS =
  FROG_SPAWN_REACTION_ALLOWANCE_MS + 900 + STORK_PICKUP_DURATION_MIN_MS;
const FROG_MIN_DISTANCE_FROM_CUTTER_PX = 135;
const FAIR_SPAWN_REACTION_TIME_SECONDS = 0.6;
const FAIR_SPAWN_SELECTION_TIME_SECONDS = 0.3;
const FAIR_SPAWN_EXTRA_BUFFER_SECONDS = 0.2;
const MAX_FAIR_SPAWN_ATTEMPTS = 20;
const INITIAL_FROG_COUNT = 2;
const MAX_ACTIVE_FROGS = 5;
const FROG_SPAWN_INTERVAL_MS = 3000;
const FROG_HIT_AREA_SCALE = 2.0;
const STORK_LANDING_SAFETY_PADDING = 40;
const TRACTOR_DANGER_WIDTH = 150;
const TRACTOR_DANGER_HEIGHT = 220;
const STORK_DANGER_LOOKAHEAD_SECONDS = 5;
const STORK_DANGER_SAMPLE_STEP_SECONDS = 0.25;
const TRACTOR_LANDING_DANGER_PADDING = 50;
const TRACTOR_EVACUATION_DANGER_PADDING = 20;
const STORK_MAX_ENERGY = 100;
const STORK_ENERGY_COST_PER_RESCUE = 50;
const STORK_ENERGY_REGEN_PER_SECOND = 4;
const FROG_CORRIDOR_MIN_X_NORMALIZED = 0.436;
const FROG_CORRIDOR_MAX_X_NORMALIZED = 0.88;
const FROG_CORRIDOR_INNER_MARGIN_X_NORMALIZED = 0.015;
const COMBINE_CUTTER_Y_NORMALIZED = 0.62;

// Trailer frog cameo prototype tuning.
const TRAILER_LEFT_RATIO = 0.167;
const TRAILER_RIGHT_RATIO = 0.279;
const TRAILER_TOP_RATIO = 0.643;
const TRAILER_BOTTOM_RATIO = 0.824;
const TRAILER_REFERENCE_COORDINATE_WIDTH = 1000;
const TRAILER_REFERENCE_COORDINATE_HEIGHT = 1000;
const TRAILER_CAMEO_DURATION_MS = 1800;

type AbortMode = "energy" | "manual";

const getStorkAbortMarginPx = (energy: number): number => {
  const fatigue =
    1 - Phaser.Math.Clamp(energy, 0, STORK_MAX_ENERGY) / STORK_MAX_ENERGY;

  return Phaser.Math.Linear(
    STORK_ABORT_MARGIN_MIN_PX,
    STORK_ABORT_MARGIN_MAX_PX,
    fatigue,
  );
};

const getStorkPickupDurationMs = (energy: number): number => {
  const fatigue =
    1 - Phaser.Math.Clamp(energy, 0, STORK_MAX_ENERGY) / STORK_MAX_ENERGY;

  return Phaser.Math.Linear(
    STORK_PICKUP_DURATION_MIN_MS,
    STORK_PICKUP_DURATION_MAX_MS,
    fatigue,
  );
};

interface FrogSpawnPosition {
  readonly x: number;
  readonly y: number;
}

interface FairSpawnEvaluation {
  readonly timeUntilCutter: number;
  readonly requiredTime: number;
}

interface TrailerFrogState {
  readonly frogId: number;
  readonly anchor: Phaser.GameObjects.Container;
  readonly animatedGroup: Phaser.GameObjects.Container;
  readonly frog: Phaser.GameObjects.Arc;
  readonly slotIndex: number;
  tongue: Phaser.GameObjects.Rectangle | null;
  finishTimer: Phaser.Time.TimerEvent | null;
  animating: boolean;
}

interface CutterMotion {
  readonly y: number;
  readonly offsetY: number;
}

type TrackingTarget = "trailer" | "cutter" | "tractorFront";
type TrailerCornerTarget = "topLeft" | "bottomRight";

interface TrailerCornerPosition {
  readonly xNormalized: number;
  readonly yNormalized: number;
}

interface FrogState {
  id: number;
  readonly gameObject: Phaser.GameObjects.Arc;
  active: boolean;
  selected: boolean;
  reserved: boolean;
  abandoned: boolean;
  rescued: boolean;
  escaped: boolean;
  pickupStork: Phaser.GameObjects.Arc | null;
  pickupTimer: Phaser.Time.TimerEvent | null;
  pickupDeparture:
    | ((rescueCompleted?: boolean, permanentlyLeave?: boolean) => void)
    | null;
  pickupEnergySnapshot: number | null;
  pickupDurationMs: number | null;
  pickupAbortMarginPx: number | null;
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
    this.input.enabled = true;

    const events = new EventBus<GameEventMap>();
    this.context = new GameContext(this, this.game.config, events);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, this.handleShutdown, this);
    events.emit(GameEvents.APP_READY, undefined);

    this.cameras.main.setBackgroundColor("#123d2b");
    const video = this.add.video(this.scale.width / 2, this.scale.height / 2, "level-video");
    const htmlVideoElement = video.video;

    if (htmlVideoElement !== null) {
      htmlVideoElement.muted = true;
      htmlVideoElement.defaultMuted = true;
      htmlVideoElement.autoplay = true;
      htmlVideoElement.playsInline = true;
      htmlVideoElement.setAttribute("playsinline", "");
      htmlVideoElement.setAttribute("webkit-playsinline", "");
      htmlVideoElement.preload = "auto";
    }

    const cutterDebugLine = this.add.graphics().setDepth(0.5);
    let rescuedCount = 0;
    let escapedCount = 0;
    let abortMode: AbortMode = "energy";
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
    const rescueParametersHud = this.add
      .text(12, 66, "", {
        color: "#fff3a3",
        fontFamily: "Arial, sans-serif",
        fontSize: "16px",
        stroke: "#123d2b",
        strokeThickness: 3,
      })
      .setDepth(3)
      .setVisible(false);
    const abortMarginDebugUi = this.add
      .container(this.scale.width - 12, 24)
      .setDepth(200)
      .setScrollFactor(0);
    const abortMarginValueText = this.add
      .text(-78, 0, `Abort: ${CUTTER_ABORT_MARGIN_PX} px`, {
        color: "#ffffff",
        fontFamily: "Arial, sans-serif",
        fontSize: "16px",
      })
      .setOrigin(1, 0.5);
    const decreaseAbortMarginButton = this.add
      .rectangle(-52, 0, 30, 28, 0x222222, 0.85)
      .setStrokeStyle(1, 0xffffff)
      .setInteractive();
    const increaseAbortMarginButton = this.add
      .rectangle(-16, 0, 30, 28, 0x222222, 0.85)
      .setStrokeStyle(1, 0xffffff)
      .setInteractive();
    const decreaseAbortMarginLabel = this.add
      .text(-52, 0, "−", { color: "#ffffff", fontSize: "20px" })
      .setOrigin(0.5);
    const increaseAbortMarginLabel = this.add
      .text(-16, 0, "+", { color: "#ffffff", fontSize: "20px" })
      .setOrigin(0.5);
    const abortModeButton = this.add
      .rectangle(-250, 0, 140, 28, 0x222222, 0.85)
      .setStrokeStyle(1, 0xffffff)
      .setInteractive();
    const abortModeLabel = this.add
      .text(-250, 0, "ABORT MODE: ENERGY", {
        color: "#ffffff",
        fontFamily: "Arial, sans-serif",
        fontSize: "11px",
      })
      .setOrigin(0.5);

    abortMarginDebugUi.add([
      abortMarginValueText,
      decreaseAbortMarginButton,
      increaseAbortMarginButton,
      decreaseAbortMarginLabel,
      increaseAbortMarginLabel,
      abortModeButton,
      abortModeLabel,
    ]);

    const changeAbortMargin = (change: number): void => {
      const previousValue = CUTTER_ABORT_MARGIN_PX;
      CUTTER_ABORT_MARGIN_PX = Phaser.Math.Clamp(
        CUTTER_ABORT_MARGIN_PX + change,
        10,
        50,
      );
      abortMarginValueText.setText(`Abort: ${CUTTER_ABORT_MARGIN_PX} px`);

      if (CUTTER_ABORT_MARGIN_PX !== previousValue) {
        console.log(`CUTTER_ABORT_MARGIN = ${CUTTER_ABORT_MARGIN_PX}`);
      }
    };

    decreaseAbortMarginButton.on(Phaser.Input.Events.POINTER_DOWN, () => {
      changeAbortMargin(-5);
    });
    increaseAbortMarginButton.on(Phaser.Input.Events.POINTER_DOWN, () => {
      changeAbortMargin(5);
    });
    abortModeButton.on(Phaser.Input.Events.POINTER_DOWN, () => {
      abortMode = abortMode === "energy" ? "manual" : "energy";
      abortModeLabel.setText(
        `ABORT MODE: ${abortMode === "energy" ? "ENERGY" : "MANUAL"}`,
      );
    });
    const frogs: FrogState[] = Array.from({ length: MAX_ACTIVE_FROGS }, () => ({
      id: 0,
      gameObject: this.add.circle(0, 0, 18, 0x00aa44).setDepth(1).setVisible(false),
      active: false,
      selected: false,
      reserved: false,
      abandoned: false,
      rescued: false,
      escaped: false,
      pickupStork: null,
      pickupTimer: null,
      pickupDeparture: null,
      pickupEnergySnapshot: null,
      pickupDurationMs: null,
      pickupAbortMarginPx: null,
      spawnPosition: { x: 0, y: 0 },
      spawnPresentedVideoTime: 0,
      spawnX: 0,
      spawnY: 0,
    }));
    let selectedFrog: FrogState | null = null;
    let nextFrogId = MAX_ACTIVE_FROGS;
    let frogSpawnTimer: Phaser.Time.TimerEvent | null = null;
    let videoReady = false;
    let videoFrameCallbackId: number | null = null;
    let usesPresentedFrameCallback = false;
    let sceneActive = true;
    let videoPlaybackStarted = false;
    let videoFramePresented = false;
    let simulationStarted = false;
    let gameOver = false;
    let videoPlayAttemptInProgress = false;
    let canPlayRetryAttempted = false;
    let canPlayRetryPending = false;
    let startupOverlayBackground: Phaser.GameObjects.Rectangle | null = null;
    let startupOverlayText: Phaser.GameObjects.Text | null = null;
    let gameOverOverlayBackground: Phaser.GameObjects.Rectangle | null = null;
    let gameOverOverlayText: Phaser.GameObjects.Text | null = null;
    let startSimulationIfReady = (): void => {};
    const storkAbortSpeechBubbles = new Set<Phaser.GameObjects.Text>();

    const resizeGameOverOverlay = (): void => {
      gameOverOverlayBackground?.setSize(
        this.scale.width,
        this.scale.height,
      );
      gameOverOverlayText?.setPosition(
        this.scale.width / 2,
        this.scale.height / 2,
      );
    };

    const showFinalResults = (): void => {
      if (!gameOver) {
        return;
      }

      gameOverOverlayText?.setText(
        `GAME OVER\n\nSAVED: ${rescuedCount}\nESCAPED: ${escapedCount}`,
      );
    };

    const triggerGameOver = (): void => {
      if (gameOver) {
        return;
      }

      gameOver = true;
      frogSpawnTimer?.remove(false);
      frogSpawnTimer = null;
      selectedFrog = null;
      this.input.enabled = false;
      gameOverOverlayBackground = this.add
        .rectangle(0, 0, this.scale.width, this.scale.height, 0x000000, 0.6)
        .setOrigin(0)
        .setDepth(400)
        .setScrollFactor(0);
      gameOverOverlayText = this.add
        .text(
          this.scale.width / 2,
          this.scale.height / 2,
          "GAME OVER",
          {
            align: "center",
            color: "#ffffff",
            fontFamily: "Arial, sans-serif",
            fontSize: "42px",
            fontStyle: "bold",
          },
        )
        .setOrigin(0.5)
        .setDepth(401)
        .setScrollFactor(0);
      console.log("GAME_OVER_TRIGGERED");

      if (htmlVideoElement?.ended) {
        showFinalResults();
      }
    };

    const handleVideoEnded = (): void => {
      showFinalResults();
    };

    htmlVideoElement?.addEventListener("ended", handleVideoEnded);

    const pickupFeedbackTexts = new Set<Phaser.GameObjects.Text>();
    const persistentTrailerFrogs: TrailerFrogState[] = [];
    const escapedFrogIdsWithCameo = new Set<number>();
    let trailerReferenceX =
      TRAILER_LEFT_RATIO * TRAILER_REFERENCE_COORDINATE_WIDTH;
    let trailerReferenceY =
      TRAILER_TOP_RATIO * TRAILER_REFERENCE_COORDINATE_HEIGHT;
    let trailerReferenceWidth =
      (TRAILER_RIGHT_RATIO - TRAILER_LEFT_RATIO) *
      TRAILER_REFERENCE_COORDINATE_WIDTH;
    let trailerReferenceHeight =
      (TRAILER_BOTTOM_RATIO - TRAILER_TOP_RATIO) *
      TRAILER_REFERENCE_COORDINATE_HEIGHT;
    let trailerCalibrationStep = 5;
    let trailerReferenceVideoTime = 0;
    let trailerCurrentY = 0;
    let getVehicleOffsetY = (_videoTime: number): number => 0;
    let getCutterMotion = (): CutterMotion => ({ y: 0, offsetY: 0 });
    const trailerTopLeftSamples: TrailerCornerSample[] =
      TRAILER_TRACK_SAMPLES.map((sample) => ({ ...sample }));
    const trailerBottomRightSamples: TrailerCornerSample[] =
      TRAILER_BOTTOM_RIGHT_SAMPLES.map((sample) => ({ ...sample }));
    const cutterTrackSamples: CutterTrackSample[] =
      CUTTER_TRACK_SAMPLES.map((sample) => ({ ...sample }));
    const tractorFrontTrackSamples: TractorFrontTrackSample[] =
      TRACTOR_FRONT_TRACK_SAMPLES.map((sample) => ({ ...sample }));
    let trailerTopLeftExtrapolationLogged = false;
    let trailerBottomRightExtrapolationLogged = false;
    let trailerTrackMode = false;
    let trackingTarget: TrackingTarget = "trailer";
    let trailerCornerTarget: TrailerCornerTarget = "topLeft";
    console.log("VIDEO_TRACKS_LOADED", {
      trailerTopLeftSamples: trailerTopLeftSamples.length,
      trailerBottomRightSamples: trailerBottomRightSamples.length,
      cutterSamples: cutterTrackSamples.length,
      tractorFrontSamples: tractorFrontTrackSamples.length,
    });
    const trailerCalibrationDebugRectangle = this.add
      .graphics()
      .setDepth(149)
      .setScrollFactor(0);
    const trailerCornerPreviewGraphics = this.add
      .graphics()
      .setDepth(148)
      .setScrollFactor(0);
    const trailerTrackPathGraphics = this.add
      .graphics()
      .setDepth(241)
      .setScrollFactor(0);
    const trailerBottomRightPathGraphics = this.add
      .graphics()
      .setDepth(241)
      .setScrollFactor(0);
    const cutterTrackPathGraphics = this.add
      .graphics()
      .setDepth(241)
      .setScrollFactor(0);
    const tractorTrackPathGraphics = this.add
      .graphics()
      .setDepth(241)
      .setScrollFactor(0);
    const tractorDangerGraphics = this.add
      .graphics()
      .setDepth(241)
      .setScrollFactor(0);
    const trailerTrackInputOverlay = this.add
      .rectangle(0, 0, 1, 1, 0x000000, 0.001)
      .setOrigin(0)
      .setDepth(240)
      .setScrollFactor(0)
      .setVisible(false);

    const showPickupSuccessFeedback = (x: number, y: number): void => {
      const feedbackText = this.add
        .text(x, y - 28, "ČÁPLÁ!", {
          color: "#fff3a3",
          fontFamily: "Arial, sans-serif",
          fontSize: "28px",
          fontStyle: "bold",
        })
        .setOrigin(0.5)
        .setScale(0.65)
        .setDepth(150)
        .setScrollFactor(0);

      pickupFeedbackTexts.add(feedbackText);
      console.log("FROG_CHAPLA");

      this.tweens.add({
        targets: feedbackText,
        scale: 1.15,
        duration: 180,
        ease: "Back.Out",
        onComplete: () => {
          this.tweens.add({
            targets: feedbackText,
            y: feedbackText.y - 20,
            alpha: 0,
            duration: 620,
            ease: "Sine.easeOut",
            onComplete: () => {
              pickupFeedbackTexts.delete(feedbackText);
              feedbackText.destroy();
            },
          });
        },
      });
    };

    // Trailer frog cameo prototype: video-relative slots, animation, and cleanup.
    const getTrailerCorner = (
      samples: readonly TrailerCornerSample[],
      videoTime: number,
      corner: TrailerCornerTarget,
    ): TrailerCornerPosition | null => {
      if (samples.length === 0) {
        return null;
      }

      if (samples.length === 1) {
        const sample = samples[0];
        return {
          xNormalized: sample.xNormalized,
          yNormalized: sample.yNormalized,
        };
      }

      const firstSample = samples[0];
      const lastSample = samples[samples.length - 1];

      if (videoTime <= firstSample.videoTime) {
        return {
          xNormalized: firstSample.xNormalized,
          yNormalized: firstSample.yNormalized,
        };
      }

      if (videoTime > lastSample.videoTime) {
        const previousSample =
          samples[samples.length - 2];
        const dt = lastSample.videoTime - previousSample.videoTime;

        if (dt <= 0) {
          return {
            xNormalized: lastSample.xNormalized,
            yNormalized: lastSample.yNormalized,
          };
        }

        const vx =
          (lastSample.xNormalized - previousSample.xNormalized) / dt;
        const vy =
          (lastSample.yNormalized - previousSample.yNormalized) / dt;
        const elapsed = videoTime - lastSample.videoTime;

        const extrapolationLogged =
          corner === "topLeft"
            ? trailerTopLeftExtrapolationLogged
            : trailerBottomRightExtrapolationLogged;

        if (!extrapolationLogged) {
          if (corner === "topLeft") {
            trailerTopLeftExtrapolationLogged = true;
          } else {
            trailerBottomRightExtrapolationLogged = true;
          }

          console.log("TRAILER_TRACK_EXTRAPOLATION_STARTED", {
            corner,
            lastTime: lastSample.videoTime,
            vx,
            vy,
          });
        }

        return {
          xNormalized: lastSample.xNormalized + vx * elapsed,
          yNormalized: lastSample.yNormalized + vy * elapsed,
        };
      }

      for (let index = 1; index < samples.length; index += 1) {
        const nextSample = samples[index];

        if (videoTime <= nextSample.videoTime) {
          const previousSample = samples[index - 1];
          const progress =
            (videoTime - previousSample.videoTime) /
            (nextSample.videoTime - previousSample.videoTime);

          return {
            xNormalized: Phaser.Math.Linear(
              previousSample.xNormalized,
              nextSample.xNormalized,
              progress,
            ),
            yNormalized: Phaser.Math.Linear(
              previousSample.yNormalized,
              nextSample.yNormalized,
              progress,
            ),
          };
        }
      }

      return null;
    };

    const getTrailerTopLeft = (
      videoTime: number,
    ): TrailerCornerPosition | null =>
      getTrailerCorner(trailerTopLeftSamples, videoTime, "topLeft");

    const getTrailerBottomRight = (
      videoTime: number,
    ): TrailerCornerPosition | null =>
      getTrailerCorner(trailerBottomRightSamples, videoTime, "bottomRight");

    const getCutterTrackedYNormalized = (videoTime: number): number | null => {
      if (cutterTrackSamples.length === 0) {
        return null;
      }

      if (cutterTrackSamples.length === 1) {
        return cutterTrackSamples[0].yNormalized;
      }

      const firstSample = cutterTrackSamples[0];
      const lastSample = cutterTrackSamples[cutterTrackSamples.length - 1];

      if (videoTime <= firstSample.videoTime) {
        return firstSample.yNormalized;
      }

      if (videoTime >= lastSample.videoTime) {
        return lastSample.yNormalized;
      }

      for (let index = 1; index < cutterTrackSamples.length; index += 1) {
        const nextSample = cutterTrackSamples[index];

        if (videoTime <= nextSample.videoTime) {
          const previousSample = cutterTrackSamples[index - 1];
          const progress =
            (videoTime - previousSample.videoTime) /
            (nextSample.videoTime - previousSample.videoTime);

          return Phaser.Math.Linear(
            previousSample.yNormalized,
            nextSample.yNormalized,
            progress,
          );
        }
      }

      return null;
    };

    const getTractorFrontTrackedAnchor = (
      videoTime: number,
    ): TrailerCornerPosition | null => {
      if (tractorFrontTrackSamples.length === 0) {
        return null;
      }

      const firstSample = tractorFrontTrackSamples[0];
      const lastSample =
        tractorFrontTrackSamples[tractorFrontTrackSamples.length - 1];

      if (tractorFrontTrackSamples.length === 1 || videoTime <= firstSample.videoTime) {
        return {
          xNormalized: firstSample.xNormalized,
          yNormalized: firstSample.yNormalized,
        };
      }

      if (videoTime > lastSample.videoTime) {
        const previousSample =
          tractorFrontTrackSamples[tractorFrontTrackSamples.length - 2];
        const dt = lastSample.videoTime - previousSample.videoTime;

        if (dt <= 0) {
          return {
            xNormalized: lastSample.xNormalized,
            yNormalized: lastSample.yNormalized,
          };
        }

        const elapsed = videoTime - lastSample.videoTime;
        return {
          xNormalized:
            lastSample.xNormalized +
            ((lastSample.xNormalized - previousSample.xNormalized) / dt) *
              elapsed,
          yNormalized:
            lastSample.yNormalized +
            ((lastSample.yNormalized - previousSample.yNormalized) / dt) *
              elapsed,
        };
      }

      for (let index = 1; index < tractorFrontTrackSamples.length; index += 1) {
        const nextSample = tractorFrontTrackSamples[index];

        if (videoTime <= nextSample.videoTime) {
          const previousSample = tractorFrontTrackSamples[index - 1];
          const progress =
            (videoTime - previousSample.videoTime) /
            (nextSample.videoTime - previousSample.videoTime);

          return {
            xNormalized: Phaser.Math.Linear(
              previousSample.xNormalized,
              nextSample.xNormalized,
              progress,
            ),
            yNormalized: Phaser.Math.Linear(
              previousSample.yNormalized,
              nextSample.yNormalized,
              progress,
            ),
          };
        }
      }

      return null;
    };

    const getTractorDangerBounds = (
      videoTime: number,
      padding: number,
    ): Phaser.Geom.Rectangle | null => {
      const trackedAnchor = getTractorFrontTrackedAnchor(videoTime);

      if (trackedAnchor === null) {
        return null;
      }

      const videoBounds = video.getBounds();
      const anchorX =
        videoBounds.left + trackedAnchor.xNormalized * videoBounds.width;
      const anchorY =
        videoBounds.top + trackedAnchor.yNormalized * videoBounds.height;

      return new Phaser.Geom.Rectangle(
        anchorX - padding,
        anchorY - padding,
        TRACTOR_DANGER_WIDTH + padding * 2,
        TRACTOR_DANGER_HEIGHT + padding * 2,
      );
    };

    const getTrailerCurrentY = (videoTime: number): number => {
      const videoBounds = video.getBounds();
      const offsetDelta =
        getVehicleOffsetY(videoTime) -
        getVehicleOffsetY(trailerReferenceVideoTime);

      return (
        trailerReferenceY -
        offsetDelta *
          (TRAILER_REFERENCE_COORDINATE_HEIGHT / videoBounds.height)
      );
    };

    const getTrailerBounds = (): Phaser.Geom.Rectangle => {
      const videoBounds = video.getBounds();
      const currentVideoTime =
        htmlVideoElement?.currentTime ?? this.presentedVideoTime;
      const topLeft = getTrailerTopLeft(currentVideoTime);
      const bottomRight = getTrailerBottomRight(currentVideoTime);
      const fixedWidth =
        videoBounds.width *
        (trailerReferenceWidth / TRAILER_REFERENCE_COORDINATE_WIDTH);
      const fixedHeight =
        videoBounds.height *
        (trailerReferenceHeight / TRAILER_REFERENCE_COORDINATE_HEIGHT);
      const fallbackLeft =
        videoBounds.left +
        videoBounds.width *
          (trailerReferenceX / TRAILER_REFERENCE_COORDINATE_WIDTH);
      const fallbackTop =
        videoBounds.top +
        videoBounds.height *
          (getTrailerCurrentY(currentVideoTime) /
            TRAILER_REFERENCE_COORDINATE_HEIGHT);
      const topLeftRendered =
        topLeft === null
          ? null
          : {
              x: videoBounds.left + topLeft.xNormalized * videoBounds.width,
              y: videoBounds.top + topLeft.yNormalized * videoBounds.height,
            };
      const bottomRightRendered =
        bottomRight === null
          ? null
          : {
              x:
                videoBounds.left +
                bottomRight.xNormalized * videoBounds.width,
              y:
                videoBounds.top +
                bottomRight.yNormalized * videoBounds.height,
            };
      let left = fallbackLeft;
      let top = fallbackTop;

      if (bottomRightRendered !== null) {
        left = bottomRightRendered.x - fixedWidth;
        top = bottomRightRendered.y - fixedHeight;
      } else if (topLeftRendered !== null) {
        left = topLeftRendered.x;
        top = topLeftRendered.y;
      }

      trailerCurrentY = top;
      return new Phaser.Geom.Rectangle(left, top, fixedWidth, fixedHeight);
    };

    const getTrailerSlotPosition = (
      slotIndex: number,
      slotCount: number,
    ): { x: number; y: number } => {
      const rows = 4;
      const columns = Math.max(2, Math.ceil(slotCount / rows));
      const column = Math.floor(slotIndex / rows);
      const row = slotIndex % rows;

      return {
        x: (column + 0.5) / columns,
        y: (row + 0.5) / rows,
      };
    };

    const updateTrailerFrogPositions = (): void => {
      const trailerBounds = getTrailerBounds();
      const videoBounds = video.getBounds();
      trailerCalibrationDebugRectangle
        .clear()
        .lineStyle(2, 0x00ffff, 0.85)
        .strokeRect(
          trailerBounds.left,
          trailerBounds.top,
          trailerBounds.width,
          trailerBounds.height,
        );

      trailerCornerPreviewGraphics.clear();
      const currentVideoTime =
        htmlVideoElement?.currentTime ?? this.presentedVideoTime;
      const topLeft = getTrailerTopLeft(currentVideoTime);
      const bottomRight = getTrailerBottomRight(currentVideoTime);

      if (topLeft !== null && bottomRight !== null) {
        const left = video.getBounds().left + topLeft.xNormalized * video.getBounds().width;
        const top = video.getBounds().top + topLeft.yNormalized * video.getBounds().height;
        const right = video.getBounds().left + bottomRight.xNormalized * video.getBounds().width;
        const bottom = video.getBounds().top + bottomRight.yNormalized * video.getBounds().height;

        if (right > left && bottom > top) {
          trailerCornerPreviewGraphics
            .lineStyle(1, 0xff00ff, 0.85)
            .strokeRect(left, top, right - left, bottom - top);
        }
      }

      for (const persistentFrog of persistentTrailerFrogs) {
        const slot = getTrailerSlotPosition(
          persistentFrog.slotIndex,
          persistentTrailerFrogs.length,
        );
        const x = trailerBounds.left + trailerBounds.width * slot.x;
        const y = trailerBounds.top + trailerBounds.height * slot.y;
        const frogRadius = 18;
        const isPartlyInsideVideo =
          x + frogRadius >= videoBounds.left &&
          x - frogRadius <= videoBounds.right &&
          y + frogRadius >= videoBounds.top &&
          y - frogRadius <= videoBounds.bottom;

        persistentFrog.anchor
          .setPosition(x, y)
          .setVisible(isPartlyInsideVideo);

        if (!persistentFrog.animating) {
          persistentFrog.animatedGroup.setScale(1);
        }
      }
    };

    const drawTrackingPaths = (): void => {
      trailerTrackPathGraphics.clear();
      trailerBottomRightPathGraphics.clear();
      cutterTrackPathGraphics.clear();
      tractorTrackPathGraphics.clear();
      tractorDangerGraphics.clear();

      if (!trailerTrackMode) {
        return;
      }

      const videoBounds = video.getBounds();
      const trailerPoints = trailerTopLeftSamples.map((sample) => ({
        x: videoBounds.left + sample.xNormalized * videoBounds.width,
        y: videoBounds.top + sample.yNormalized * videoBounds.height,
      }));

      if (trailerPoints.length > 0) {
        trailerTrackPathGraphics.lineStyle(1, 0x00ffff, 0.85);
        trailerTrackPathGraphics.beginPath();
        trailerTrackPathGraphics.moveTo(
          trailerPoints[0].x,
          trailerPoints[0].y,
        );

        for (let index = 1; index < trailerPoints.length; index += 1) {
          trailerTrackPathGraphics.lineTo(
            trailerPoints[index].x,
            trailerPoints[index].y,
          );
        }

        trailerTrackPathGraphics.strokePath();
        trailerTrackPathGraphics.fillStyle(0x00ffff, 1);

        for (const point of trailerPoints) {
          trailerTrackPathGraphics.fillCircle(point.x, point.y, 4);
        }
      }

      const trailerBottomRightPoints = trailerBottomRightSamples.map((sample) => ({
        x: videoBounds.left + sample.xNormalized * videoBounds.width,
        y: videoBounds.top + sample.yNormalized * videoBounds.height,
      }));

      if (trailerBottomRightPoints.length > 0) {
        trailerBottomRightPathGraphics.lineStyle(1, 0xff00ff, 0.85);
        trailerBottomRightPathGraphics.beginPath();
        trailerBottomRightPathGraphics.moveTo(
          trailerBottomRightPoints[0].x,
          trailerBottomRightPoints[0].y,
        );

        for (let index = 1; index < trailerBottomRightPoints.length; index += 1) {
          trailerBottomRightPathGraphics.lineTo(
            trailerBottomRightPoints[index].x,
            trailerBottomRightPoints[index].y,
          );
        }

        trailerBottomRightPathGraphics.strokePath();
        trailerBottomRightPathGraphics.fillStyle(0xff00ff, 1);

        for (const point of trailerBottomRightPoints) {
          trailerBottomRightPathGraphics.fillCircle(point.x, point.y, 4);
        }
      }

      const cutterCenterX = videoBounds.centerX;
      const cutterPoints = cutterTrackSamples.map((sample) => ({
        x: cutterCenterX,
        y: videoBounds.top + sample.yNormalized * videoBounds.height,
      }));

      if (cutterPoints.length > 0) {
        cutterTrackPathGraphics.lineStyle(1, 0xffff00, 0.9);
        cutterTrackPathGraphics.beginPath();
        cutterTrackPathGraphics.moveTo(cutterPoints[0].x, cutterPoints[0].y);

        for (let index = 1; index < cutterPoints.length; index += 1) {
          cutterTrackPathGraphics.lineTo(
            cutterPoints[index].x,
            cutterPoints[index].y,
          );
        }

        cutterTrackPathGraphics.strokePath();

        for (const point of cutterPoints) {
          cutterTrackPathGraphics
            .beginPath()
            .moveTo(point.x - 12, point.y)
            .lineTo(point.x + 12, point.y)
            .strokePath();
        }
      }

      const tractorPoints = tractorFrontTrackSamples.map((sample) => ({
        x: videoBounds.left + sample.xNormalized * videoBounds.width,
        y: videoBounds.top + sample.yNormalized * videoBounds.height,
      }));

      if (tractorPoints.length > 0) {
        tractorTrackPathGraphics.lineStyle(2, 0xff8800, 0.95);
        tractorTrackPathGraphics.beginPath();
        tractorTrackPathGraphics.moveTo(tractorPoints[0].x, tractorPoints[0].y);

        for (let index = 1; index < tractorPoints.length; index += 1) {
          tractorTrackPathGraphics.lineTo(
            tractorPoints[index].x,
            tractorPoints[index].y,
          );
        }

        tractorTrackPathGraphics.strokePath();
        tractorTrackPathGraphics.fillStyle(0xff8800, 1);

        for (const point of tractorPoints) {
          tractorTrackPathGraphics.fillCircle(point.x, point.y, 4);
        }

        const currentTime =
          htmlVideoElement?.currentTime ?? this.presentedVideoTime;

        for (
          let secondsAhead = 0;
          secondsAhead <= STORK_DANGER_LOOKAHEAD_SECONDS;
          secondsAhead += 1
        ) {
          const dangerBounds = getTractorDangerBounds(
            currentTime + secondsAhead,
            secondsAhead === 0
              ? TRACTOR_EVACUATION_DANGER_PADDING
              : TRACTOR_LANDING_DANGER_PADDING,
          );

          if (dangerBounds !== null) {
            tractorDangerGraphics
              .lineStyle(
                secondsAhead === 0 ? 2 : 1,
                0xff8800,
                Math.max(0.18, 0.9 - secondsAhead * 0.13),
              )
              .strokeRectShape(dangerBounds);
          }
        }
      }
    };

    const destroyTrailerCameoObjects = (): void => {
      for (const persistentFrog of persistentTrailerFrogs) {
        persistentFrog.finishTimer?.remove(false);
        this.tweens.killTweensOf(persistentFrog.animatedGroup);
        this.tweens.killTweensOf(persistentFrog.frog);
        persistentFrog.tongue?.destroy();
        persistentFrog.anchor.destroy(true);
      }

      persistentTrailerFrogs.length = 0;
      escapedFrogIdsWithCameo.clear();
    };

    const addPersistentTrailerFrog = (frogId: number): void => {
      if (!sceneActive) {
        return;
      }

      console.assert(
        !escapedFrogIdsWithCameo.has(frogId),
        "TRAILER_FROG_DUPLICATE",
        { frogId },
      );

      if (escapedFrogIdsWithCameo.has(frogId)) {
        return;
      }

      const slotIndex = persistentTrailerFrogs.length;
      const anchor = this.add
        .container(0, 0)
        .setDepth(150)
        .setScrollFactor(0);
      const tongue = this.add
        .rectangle(10, 3, 22, 5, 0xff77aa)
        .setOrigin(0, 0.5)
        .setScale(0, 1);
      const frog = this.add.circle(0, 0, 18, 0x00aa44);
      const animatedGroup = this.add.container(0, 28, [tongue, frog]);
      anchor.add(animatedGroup);
      animatedGroup.setScale(0.7);
      const persistentFrog: TrailerFrogState = {
        frogId,
        anchor,
        animatedGroup,
        frog,
        slotIndex,
        tongue,
        finishTimer: null,
        animating: true,
      };

      escapedFrogIdsWithCameo.add(frogId);
      persistentTrailerFrogs.push(persistentFrog);
      updateTrailerFrogPositions();
      console.log("TRAILER_FROG_ADDED", {
        frogId,
        escapedCount,
        persistentCount: persistentTrailerFrogs.length,
        slotIndex,
      });

      this.tweens.add({
        targets: animatedGroup,
        y: 0,
        scale: 1,
        duration: 300,
        ease: "Back.Out",
        onComplete: () => {
          this.tweens.add({
            targets: animatedGroup,
            angle: 9,
            duration: 180,
            ease: "Sine.easeInOut",
            yoyo: true,
            repeat: 3,
          });
          this.tweens.add({
            targets: tongue,
            scaleX: 1,
            duration: 140,
            hold: 160,
            yoyo: true,
            ease: "Sine.easeOut",
          });
        },
      });

      persistentFrog.finishTimer = this.time.delayedCall(
        TRAILER_CAMEO_DURATION_MS,
        () => {
          persistentFrog.finishTimer = null;
          this.tweens.killTweensOf(animatedGroup);
          animatedGroup.setAngle(0).setY(0).setAlpha(1).setScale(1);
          persistentFrog.tongue?.destroy();
          persistentFrog.tongue = null;
          persistentFrog.animating = false;
          updateTrailerFrogPositions();
        },
      );
    };

    // TRAILER_CALIBRATION_DEBUG
    const trailerCalibrationDebugPanel = this.add
      .container(this.scale.width - 8, 62)
      .setDepth(250)
      .setScrollFactor(0);
    const trailerCalibrationPanelBackground = this.add
      .rectangle(-150, 290, 300, 580, 0x101820, 0.88)
      .setStrokeStyle(1, 0x00ffff, 0.75);
    const trailerCalibrationValuesText = this.add.text(-288, 10, "", {
      color: "#ffffff",
      fontFamily: "Arial, sans-serif",
      fontSize: "11px",
      lineSpacing: 1,
    });
    trailerCalibrationDebugPanel.add([
      trailerCalibrationPanelBackground,
      trailerCalibrationValuesText,
    ]);

    const refreshTrailerCalibrationDebug = (): void => {
      const currentVideoTime =
        htmlVideoElement?.currentTime ?? this.presentedVideoTime;
      const referenceVehicleOffsetY = getVehicleOffsetY(
        trailerReferenceVideoTime,
      );
      const currentVehicleOffsetY = getVehicleOffsetY(currentVideoTime);
      trailerCalibrationValuesText.setText([
        "Trailer",
        `X: ${trailerReferenceX.toFixed(0)}`,
        `Y: ${trailerReferenceY.toFixed(0)}`,
        `W: ${trailerReferenceWidth.toFixed(0)}`,
        `H: ${trailerReferenceHeight.toFixed(0)}`,
        `Step: ${trailerCalibrationStep}`,
        `Trailer TL points: ${trailerTopLeftSamples.length}`,
        `Trailer BR points: ${trailerBottomRightSamples.length}`,
        `Cutter points: ${cutterTrackSamples.length}`,
        `Tractor points: ${tractorFrontTrackSamples.length}`,
        trackingTarget === "trailer"
          ? trailerCornerTarget === "topLeft"
            ? "Klikni na levý horní roh vlečky"
            : "Klikni na pravý dolní roh vlečky"
          : trackingTarget === "cutter"
            ? "Klikni vždy na stejný bod žací lišty"
            : "Klikni na levý horní roh předku traktoru",
        `World drift: ${FROG_DRIFT_PX_PER_SECOND.toFixed(2)} px/s`,
        `World stop: ${WORLD_MOVEMENT_END_VIDEO_TIME.toFixed(2)} s`,
        `Reference time: ${trailerReferenceVideoTime.toFixed(2)} s`,
        `Current time: ${currentVideoTime.toFixed(2)} s`,
        `Reference offset: ${referenceVehicleOffsetY.toFixed(1)}`,
        `Current offset: ${currentVehicleOffsetY.toFixed(1)}`,
        `Current trailer Y: ${trailerCurrentY.toFixed(1)}`,
      ]);
    };

    const applyTrailerCalibrationChange = (change: () => void): void => {
      change();
      trailerReferenceWidth = Phaser.Math.Clamp(
        trailerReferenceWidth,
        5,
        TRAILER_REFERENCE_COORDINATE_WIDTH,
      );
      trailerReferenceHeight = Phaser.Math.Clamp(
        trailerReferenceHeight,
        5,
        TRAILER_REFERENCE_COORDINATE_HEIGHT,
      );
      trailerReferenceX = Phaser.Math.Clamp(
        trailerReferenceX,
        0,
        TRAILER_REFERENCE_COORDINATE_WIDTH - trailerReferenceWidth,
      );
      trailerReferenceY = Phaser.Math.Clamp(
        trailerReferenceY,
        0,
        TRAILER_REFERENCE_COORDINATE_HEIGHT - trailerReferenceHeight,
      );
      updateTrailerFrogPositions();
      refreshTrailerCalibrationDebug();
    };

    const setCurrentTrailerAsReference = (): void => {
      const currentBounds = getTrailerBounds();
      const videoBounds = video.getBounds();

      trailerReferenceX =
        ((currentBounds.left - videoBounds.left) / videoBounds.width) *
        TRAILER_REFERENCE_COORDINATE_WIDTH;
      trailerReferenceY =
        ((currentBounds.top - videoBounds.top) / videoBounds.height) *
        TRAILER_REFERENCE_COORDINATE_HEIGHT;
      trailerReferenceWidth =
        (currentBounds.width / videoBounds.width) *
        TRAILER_REFERENCE_COORDINATE_WIDTH;
      trailerReferenceHeight =
        (currentBounds.height / videoBounds.height) *
        TRAILER_REFERENCE_COORDINATE_HEIGHT;
      trailerReferenceVideoTime =
        htmlVideoElement?.currentTime ?? this.presentedVideoTime;
      const referenceCheck = getTrailerCurrentY(trailerReferenceVideoTime);
      console.assert(
        Math.abs(referenceCheck - trailerReferenceY) < 0.01,
        "TRAILER_REFERENCE_MISMATCH",
        {
          trailerReferenceY,
          trailerReferenceVideoTime,
          referenceCheck,
          referenceOffset: getVehicleOffsetY(trailerReferenceVideoTime),
        },
      );
      updateTrailerFrogPositions();
      refreshTrailerCalibrationDebug();
    };

    const logTrailerCalibration = (): void => {
      const currentVideoTime =
        htmlVideoElement?.currentTime ?? this.presentedVideoTime;
      const referenceVehicleOffsetY = getVehicleOffsetY(
        trailerReferenceVideoTime,
      );
      const currentVehicleOffsetY = getVehicleOffsetY(currentVideoTime);

      console.log("TRAILER_CALIBRATION =", {
        referenceX: trailerReferenceX,
        referenceY: trailerReferenceY,
        width: trailerReferenceWidth,
        height: trailerReferenceHeight,
        referenceVideoTime: trailerReferenceVideoTime,
        referenceVehicleOffsetY,
        currentVideoTime,
        currentVehicleOffsetY,
        currentTrailerY: trailerCurrentY,
      });
    };

    const addTrailerCalibrationButton = (
      x: number,
      y: number,
      width: number,
      label: string,
      onPress: () => void,
    ): Phaser.GameObjects.Text => {
      const button = this.add
        .rectangle(x, y, width, 24, 0x263744, 0.95)
        .setStrokeStyle(1, 0xffffff, 0.7)
        .setInteractive();
      const buttonLabel = this.add
        .text(x, y, label, {
          color: "#ffffff",
          fontFamily: "Arial, sans-serif",
          fontSize: "12px",
        })
        .setOrigin(0.5);

      button.on(Phaser.Input.Events.POINTER_DOWN, onPress);
      trailerCalibrationDebugPanel.add([button, buttonLabel]);
      return buttonLabel;
    };

    const recordTrailerTrackSample = (pointer: Phaser.Input.Pointer): void => {
      const videoBounds = video.getBounds();

      if (!Phaser.Geom.Rectangle.Contains(videoBounds, pointer.x, pointer.y)) {
        return;
      }

      const videoTime =
        htmlVideoElement?.currentTime ?? this.presentedVideoTime;
      const sample: TrailerCornerSample = {
        videoTime,
        xNormalized: Phaser.Math.Clamp(
          (pointer.x - videoBounds.x) / videoBounds.width,
          0,
          1,
        ),
        yNormalized: Phaser.Math.Clamp(
          (pointer.y - videoBounds.y) / videoBounds.height,
          0,
          1,
        ),
      };
      const activeCornerSamples =
        trailerCornerTarget === "topLeft"
          ? trailerTopLeftSamples
          : trailerBottomRightSamples;
      const replacementIndex = activeCornerSamples.findIndex(
        (candidate) => Math.abs(candidate.videoTime - videoTime) <= 0.15,
      );

      if (replacementIndex >= 0) {
        activeCornerSamples[replacementIndex] = sample;
      } else {
        activeCornerSamples.push(sample);
      }

      activeCornerSamples.sort(
        (first, second) => first.videoTime - second.videoTime,
      );
      if (trailerCornerTarget === "topLeft") {
        trailerTopLeftExtrapolationLogged = false;
      } else {
        trailerBottomRightExtrapolationLogged = false;
      }
      console.log("TRAILER_TRACK_SAMPLE", {
        corner: trailerCornerTarget,
        videoTime,
        xNormalized: sample.xNormalized,
        yNormalized: sample.yNormalized,
        renderedX: pointer.x,
        renderedY: pointer.y,
      });
      updateTrailerFrogPositions();
      drawTrackingPaths();
      refreshTrailerCalibrationDebug();
    };

    const recordCutterTrackSample = (pointer: Phaser.Input.Pointer): void => {
      const videoBounds = video.getBounds();

      if (!Phaser.Geom.Rectangle.Contains(videoBounds, pointer.x, pointer.y)) {
        return;
      }

      const videoTime =
        htmlVideoElement?.currentTime ?? this.presentedVideoTime;
      const sample: CutterTrackSample = {
        videoTime,
        yNormalized: Phaser.Math.Clamp(
          (pointer.y - videoBounds.y) / videoBounds.height,
          0,
          1,
        ),
      };
      const replacementIndex = cutterTrackSamples.findIndex(
        (candidate) => Math.abs(candidate.videoTime - videoTime) <= 0.15,
      );

      if (replacementIndex >= 0) {
        cutterTrackSamples[replacementIndex] = sample;
      } else {
        cutterTrackSamples.push(sample);
      }

      cutterTrackSamples.sort(
        (first, second) => first.videoTime - second.videoTime,
      );
      console.log("CUTTER_TRACK_SAMPLE", {
        videoTime,
        yNormalized: sample.yNormalized,
        renderedY: pointer.y,
      });
      drawTrackingPaths();
      refreshTrailerCalibrationDebug();
    };

    const recordTractorFrontTrackSample = (
      pointer: Phaser.Input.Pointer,
    ): void => {
      const videoBounds = video.getBounds();

      if (!Phaser.Geom.Rectangle.Contains(videoBounds, pointer.x, pointer.y)) {
        return;
      }

      const videoTime =
        htmlVideoElement?.currentTime ?? this.presentedVideoTime;
      const sample: TractorFrontTrackSample = {
        videoTime,
        xNormalized: Phaser.Math.Clamp(
          (pointer.x - videoBounds.x) / videoBounds.width,
          0,
          1,
        ),
        yNormalized: Phaser.Math.Clamp(
          (pointer.y - videoBounds.y) / videoBounds.height,
          0,
          1,
        ),
      };
      const replacementIndex = tractorFrontTrackSamples.findIndex(
        (candidate) => Math.abs(candidate.videoTime - videoTime) <= 0.15,
      );

      if (replacementIndex >= 0) {
        tractorFrontTrackSamples[replacementIndex] = sample;
      } else {
        tractorFrontTrackSamples.push(sample);
      }

      tractorFrontTrackSamples.sort(
        (first, second) => first.videoTime - second.videoTime,
      );
      console.log("TRACTOR_FRONT_TRACK_SAMPLE", {
        videoTime,
        xNormalized: sample.xNormalized,
        yNormalized: sample.yNormalized,
        renderedX: pointer.x,
        renderedY: pointer.y,
      });
      drawTrackingPaths();
      refreshTrailerCalibrationDebug();
    };

    trailerTrackInputOverlay.on(
      Phaser.Input.Events.POINTER_DOWN,
      (
        pointer: Phaser.Input.Pointer,
        _localX: number,
        _localY: number,
        event: Phaser.Types.Input.EventData,
      ) => {
        event.stopPropagation();

        if (trailerTrackMode) {
          if (trackingTarget === "trailer") {
            recordTrailerTrackSample(pointer);
          } else if (trackingTarget === "cutter") {
            recordCutterTrackSample(pointer);
          } else {
            recordTractorFrontTrackSample(pointer);
          }
        }
      },
    );

    addTrailerCalibrationButton(-262, 232, 48, "X-", () => {
      applyTrailerCalibrationChange(() => {
        trailerReferenceX -= trailerCalibrationStep;
      });
    });
    addTrailerCalibrationButton(-208, 232, 48, "X+", () => {
      applyTrailerCalibrationChange(() => {
        trailerReferenceX += trailerCalibrationStep;
      });
    });
    addTrailerCalibrationButton(-128, 232, 48, "Y-", () => {
      applyTrailerCalibrationChange(() => {
        trailerReferenceY -= trailerCalibrationStep;
      });
    });
    addTrailerCalibrationButton(-74, 232, 48, "Y+", () => {
      applyTrailerCalibrationChange(() => {
        trailerReferenceY += trailerCalibrationStep;
      });
    });
    addTrailerCalibrationButton(-262, 262, 48, "W-", () => {
      applyTrailerCalibrationChange(() => {
        trailerReferenceWidth -= trailerCalibrationStep;
      });
    });
    addTrailerCalibrationButton(-208, 262, 48, "W+", () => {
      applyTrailerCalibrationChange(() => {
        trailerReferenceWidth += trailerCalibrationStep;
      });
    });
    addTrailerCalibrationButton(-128, 262, 48, "H-", () => {
      applyTrailerCalibrationChange(() => {
        trailerReferenceHeight -= trailerCalibrationStep;
      });
    });
    addTrailerCalibrationButton(-74, 262, 48, "H+", () => {
      applyTrailerCalibrationChange(() => {
        trailerReferenceHeight += trailerCalibrationStep;
      });
    });
    addTrailerCalibrationButton(-254, 294, 64, "DRIFT-", () => {
      applyTrailerCalibrationChange(() => {
        FROG_DRIFT_PX_PER_SECOND = Math.max(
          0,
          FROG_DRIFT_PX_PER_SECOND - 1,
        );
      });
    });
    addTrailerCalibrationButton(-182, 294, 64, "DRIFT+", () => {
      applyTrailerCalibrationChange(() => {
        FROG_DRIFT_PX_PER_SECOND += 1;
      });
    });
    addTrailerCalibrationButton(-110, 294, 64, "STOP-", () => {
      applyTrailerCalibrationChange(() => {
        WORLD_MOVEMENT_END_VIDEO_TIME = Math.max(
          0,
          WORLD_MOVEMENT_END_VIDEO_TIME - 0.25,
        );
      });
    });
    addTrailerCalibrationButton(-38, 294, 64, "STOP+", () => {
      applyTrailerCalibrationChange(() => {
        WORLD_MOVEMENT_END_VIDEO_TIME += 0.25;
      });
    });
    addTrailerCalibrationButton(-230, 332, 112, "STEP 1/5", () => {
      trailerCalibrationStep = trailerCalibrationStep === 5 ? 1 : 5;
      refreshTrailerCalibrationDebug();
    });
    addTrailerCalibrationButton(-94, 332, 144, "LOG CALIBRATION", () => {
      setCurrentTrailerAsReference();
      logTrailerCalibration();
    });
    addTrailerCalibrationButton(
      -150,
      366,
      260,
      "SET CURRENT AS REFERENCE",
      () => {
        setCurrentTrailerAsReference();
        logTrailerCalibration();
      },
    );
    let trailerTrackModeButtonLabel: Phaser.GameObjects.Text;
    trailerTrackModeButtonLabel = addTrailerCalibrationButton(
      -150,
      400,
      260,
      "TRAILER TRACK MODE: OFF",
      () => {
        trailerTrackMode = !trailerTrackMode;
        trailerTrackModeButtonLabel.setText(
          `TRAILER TRACK MODE: ${trailerTrackMode ? "ON" : "OFF"}`,
        );

        if (trailerTrackMode) {
          trailerTrackInputOverlay.setVisible(true).setInteractive();
        } else {
          trailerTrackInputOverlay.disableInteractive().setVisible(false);
        }

        drawTrackingPaths();
        refreshTrailerCalibrationDebug();
      },
    );
    let trackingTargetButtonLabel: Phaser.GameObjects.Text;
    let trailerCornerButtonLabel: Phaser.GameObjects.Text;
    let clearTrackButtonLabel: Phaser.GameObjects.Text;
    let undoTrackButtonLabel: Phaser.GameObjects.Text;
    let exportTrackButtonLabel: Phaser.GameObjects.Text;
    const refreshTrackingButtonLabels = (): void => {
      const targetLabel =
        trackingTarget === "trailer"
          ? "TRAILER"
          : trackingTarget === "cutter"
            ? "CUTTER"
            : "TRACTOR FRONT";
      const cornerLabel =
        trailerCornerTarget === "topLeft" ? "TOP LEFT" : "BOTTOM RIGHT";
      const actionTargetLabel =
        trackingTarget === "trailer"
          ? cornerLabel
          : trackingTarget === "cutter"
            ? "CUTTER"
            : "TRACTOR FRONT";
      trackingTargetButtonLabel.setText(`TRACK TARGET: ${targetLabel}`);
      trailerCornerButtonLabel.setText(`TRAILER CORNER: ${cornerLabel}`);
      clearTrackButtonLabel.setText(`CLEAR ${actionTargetLabel}`);
      undoTrackButtonLabel.setText(`UNDO ${actionTargetLabel}`);
      exportTrackButtonLabel.setText(`EXPORT ${actionTargetLabel}`);
    };

    trackingTargetButtonLabel = addTrailerCalibrationButton(
      -150,
      434,
      260,
      "TRACK TARGET: TRAILER",
      () => {
        trackingTarget =
          trackingTarget === "trailer"
            ? "cutter"
            : trackingTarget === "cutter"
              ? "tractorFront"
              : "trailer";
        refreshTrackingButtonLabels();
        refreshTrailerCalibrationDebug();
      },
    );
    trailerCornerButtonLabel = addTrailerCalibrationButton(
      -150,
      468,
      260,
      "TRAILER CORNER: TOP LEFT",
      () => {
        trailerCornerTarget =
          trailerCornerTarget === "topLeft" ? "bottomRight" : "topLeft";
        refreshTrackingButtonLabels();
        refreshTrailerCalibrationDebug();
      },
    );
    clearTrackButtonLabel = addTrailerCalibrationButton(
      -250,
      502,
      84,
      "CLEAR TRAILER",
      () => {
        if (trackingTarget === "trailer") {
          const activeCornerSamples =
            trailerCornerTarget === "topLeft"
              ? trailerTopLeftSamples
              : trailerBottomRightSamples;
          activeCornerSamples.length = 0;

          if (trailerCornerTarget === "topLeft") {
            trailerTopLeftExtrapolationLogged = false;
          } else {
            trailerBottomRightExtrapolationLogged = false;
          }

          updateTrailerFrogPositions();
        } else if (trackingTarget === "cutter") {
          cutterTrackSamples.length = 0;
        } else {
          tractorFrontTrackSamples.length = 0;
        }

        drawTrackingPaths();
        refreshTrailerCalibrationDebug();
      },
    );
    undoTrackButtonLabel = addTrailerCalibrationButton(
      -150,
      502,
      84,
      "UNDO TRAILER",
      () => {
        if (trackingTarget === "trailer") {
          const activeCornerSamples =
            trailerCornerTarget === "topLeft"
              ? trailerTopLeftSamples
              : trailerBottomRightSamples;
          activeCornerSamples.pop();

          if (trailerCornerTarget === "topLeft") {
            trailerTopLeftExtrapolationLogged = false;
          } else {
            trailerBottomRightExtrapolationLogged = false;
          }

          updateTrailerFrogPositions();
        } else if (trackingTarget === "cutter") {
          cutterTrackSamples.pop();
        } else {
          tractorFrontTrackSamples.pop();
        }

        drawTrackingPaths();
        refreshTrailerCalibrationDebug();
      },
    );
    exportTrackButtonLabel = addTrailerCalibrationButton(
      -50,
      502,
      84,
      "EXPORT TRAILER",
      () => {
        if (trackingTarget === "trailer") {
          const activeCornerSamples =
            trailerCornerTarget === "topLeft"
              ? trailerTopLeftSamples
              : trailerBottomRightSamples;
          const exportName =
            trailerCornerTarget === "topLeft"
              ? "TRAILER_TOP_LEFT_SAMPLES"
              : "TRAILER_BOTTOM_RIGHT_SAMPLES";
          const exportedSamples = activeCornerSamples
            .map(
              (sample) =>
                `  { videoTime: ${sample.videoTime.toFixed(3)}, ` +
                `xNormalized: ${sample.xNormalized.toFixed(6)}, ` +
                `yNormalized: ${sample.yNormalized.toFixed(6)} },`,
            )
            .join("\n");
          console.log(
            `const ${exportName}: TrailerCornerSample[] = [\n` +
              exportedSamples +
              "\n];",
          );
          return;
        }

        if (trackingTarget === "cutter") {
          const exportedSamples = cutterTrackSamples
            .map(
              (sample) =>
                `  { videoTime: ${sample.videoTime.toFixed(3)}, ` +
                `yNormalized: ${sample.yNormalized.toFixed(6)} },`,
            )
            .join("\n");
          console.log(
            "const CUTTER_TRACK_SAMPLES: CutterTrackSample[] = [\n" +
              exportedSamples +
              "\n];",
          );
          return;
        }

        const exportedSamples = tractorFrontTrackSamples
          .map(
            (sample) =>
              `  { videoTime: ${sample.videoTime.toFixed(3)}, ` +
              `xNormalized: ${sample.xNormalized.toFixed(6)}, ` +
              `yNormalized: ${sample.yNormalized.toFixed(6)} },`,
          )
          .join("\n");
        console.log(
          "const TRACTOR_FRONT_TRACK_SAMPLES: TractorFrontTrackSample[] = [\n" +
            exportedSamples +
            "\n];",
        );
      },
    );
    refreshTrackingButtonLabels();
    refreshTrailerCalibrationDebug();

    const resizeStartupOverlay = (): void => {
      startupOverlayBackground?.setSize(this.scale.width, this.scale.height);
      startupOverlayText?.setPosition(this.scale.width / 2, this.scale.height / 2);
    };

    const destroyStartupOverlay = (): void => {
      startupOverlayBackground?.removeAllListeners();
      startupOverlayBackground?.destroy();
      startupOverlayText?.destroy();
      startupOverlayBackground = null;
      startupOverlayText = null;
    };

    const showStartupOverlay = (): void => {
      if (startupOverlayBackground !== null) {
        return;
      }

      startupOverlayBackground = this.add
        .rectangle(0, 0, this.scale.width, this.scale.height, 0x000000, 0.75)
        .setOrigin(0)
        .setDepth(100)
        .setInteractive();
      startupOverlayText = this.add
        .text(
          this.scale.width / 2,
          this.scale.height / 2,
          "KLEPNI PRO SPUŠTĚNÍ",
          {
            color: "#ffffff",
            fontFamily: "Arial, sans-serif",
            fontSize: "28px",
          },
        )
        .setOrigin(0.5)
        .setDepth(101);

      startupOverlayBackground.on(Phaser.Input.Events.POINTER_DOWN, () => {
        attemptVideoPlayback("touch");
      });
    };

    const finishSuccessfulPlayback = (source: "autoplay" | "touch"): void => {
      videoPlaybackStarted = true;

      if (source === "touch") {
        console.log("VIDEO_TOUCH_PLAY_STARTED");
      } else {
        console.log("VIDEO_AUTOPLAY_STARTED");
      }

      destroyStartupOverlay();
      startSimulationIfReady();
    };

    const finishFailedPlayback = (
      source: "autoplay" | "touch",
      error: unknown,
    ): void => {
      if (source === "touch") {
        console.error("VIDEO_TOUCH_PLAY_FAILED", error);
      } else {
        console.error("VIDEO_AUTOPLAY_BLOCKED", error);
      }

      showStartupOverlay();
    };

    function attemptVideoPlayback(source: "autoplay" | "touch"): void {
      if (
        htmlVideoElement === null ||
        videoPlaybackStarted ||
        videoPlayAttemptInProgress
      ) {
        return;
      }

      videoPlayAttemptInProgress = true;

      let playPromise: Promise<void>;

      try {
        playPromise = htmlVideoElement.play();
      } catch (error: unknown) {
        videoPlayAttemptInProgress = false;
        finishFailedPlayback(source, error);
        return;
      }

      void playPromise
        .then(() => {
          if (htmlVideoElement.paused) {
            throw new Error("Video remained paused after play() resolved.");
          }

          finishSuccessfulPlayback(source);
        })
        .catch((error: unknown) => {
          finishFailedPlayback(source, error);
        })
        .finally(() => {
          videoPlayAttemptInProgress = false;

          if (canPlayRetryPending && !videoPlaybackStarted) {
            canPlayRetryPending = false;
            canPlayRetryAttempted = true;
            attemptVideoPlayback("autoplay");
          }
        });
    }

    const handleCanPlay = (): void => {
      console.log("VIDEO_CANPLAY");

      if (videoPlaybackStarted || canPlayRetryAttempted) {
        return;
      }

      if (videoPlayAttemptInProgress) {
        canPlayRetryPending = true;
        return;
      }

      canPlayRetryAttempted = true;
      attemptVideoPlayback("autoplay");
    };

    htmlVideoElement?.addEventListener("canplay", handleCanPlay, { once: true });

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

    getVehicleOffsetY = (videoTime: number): number => {
      const worldStopTime = WORLD_MOVEMENT_END_VIDEO_TIME;
      const phaseOneOffset = getWorldOffset(
        Math.min(videoTime, worldStopTime),
        0,
      );
      const phaseTwoElapsed = Math.max(0, videoTime - worldStopTime);
      const videoBounds = video.getBounds();
      const cutterSpeedPxPerSecond =
        (COMBINE_CUTTER_Y_NORMALIZED * videoBounds.height) /
        CUTTER_PHASE_TWO_DURATION_SECONDS;
      const phaseTwoOffset = phaseTwoElapsed * cutterSpeedPxPerSecond;

      return phaseOneOffset + phaseTwoOffset;
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

    getCutterMotion = (): CutterMotion => {
      const videoBounds = video.getBounds();
      const initialY =
        videoBounds.top + COMBINE_CUTTER_Y_NORMALIZED * videoBounds.height;
      const currentVideoTime =
        htmlVideoElement?.currentTime ?? this.presentedVideoTime;
      const trackedYNormalized =
        getCutterTrackedYNormalized(currentVideoTime);
      const y =
        trackedYNormalized === null
          ? videoBounds.top +
            getCurrentCutterYNormalized() * videoBounds.height
          : videoBounds.top + trackedYNormalized * videoBounds.height;

      return {
        y,
        offsetY: initialY - y,
      };
    };

    const getCutterYAtVideoTime = (videoTime: number): number => {
      const videoBounds = video.getBounds();
      const trackedYNormalized = getCutterTrackedYNormalized(videoTime);

      if (trackedYNormalized !== null) {
        return videoBounds.top + trackedYNormalized * videoBounds.height;
      }

      const phaseTwoElapsed = Math.max(
        0,
        videoTime - WORLD_MOVEMENT_END_VIDEO_TIME,
      );
      const phaseTwoProgress = Phaser.Math.Clamp(
        phaseTwoElapsed / CUTTER_PHASE_TWO_DURATION_SECONDS,
        0,
        1,
      );
      const fallbackYNormalized =
        videoTime <= WORLD_MOVEMENT_END_VIDEO_TIME
          ? COMBINE_CUTTER_Y_NORMALIZED
          : Phaser.Math.Linear(
              COMBINE_CUTTER_Y_NORMALIZED,
              0,
              phaseTwoProgress,
            );

      return videoBounds.top + fallbackYNormalized * videoBounds.height;
    };

    const getTimeUntilCutterSeconds = (
      frogSpawnY: number,
      spawnVideoTime: number,
    ): number => {
      const getClearance = (videoTime: number): number =>
        getCutterYAtVideoTime(videoTime) -
        (frogSpawnY + getWorldOffset(videoTime, spawnVideoTime));

      if (getClearance(spawnVideoTime) <= 0) {
        return 0;
      }

      const videoDuration = htmlVideoElement?.duration;
      const finalVideoTime =
        videoDuration !== undefined &&
        Number.isFinite(videoDuration) &&
        videoDuration > spawnVideoTime
          ? videoDuration
          : spawnVideoTime + 60;
      const sampleStepSeconds = 0.1;
      let previousTime = spawnVideoTime;

      for (
        let sampleTime = spawnVideoTime + sampleStepSeconds;
        sampleTime <= finalVideoTime + sampleStepSeconds / 2;
        sampleTime += sampleStepSeconds
      ) {
        const boundedSampleTime = Math.min(sampleTime, finalVideoTime);

        if (getClearance(boundedSampleTime) <= 0) {
          let safeTime = previousTime;
          let unsafeTime = boundedSampleTime;

          for (let iteration = 0; iteration < 12; iteration += 1) {
            const midpoint = (safeTime + unsafeTime) / 2;

            if (getClearance(midpoint) > 0) {
              safeTime = midpoint;
            } else {
              unsafeTime = midpoint;
            }
          }

          return unsafeTime - spawnVideoTime;
        }

        if (boundedSampleTime >= finalVideoTime) {
          break;
        }

        previousTime = boundedSampleTime;
      }

      return Number.POSITIVE_INFINITY;
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
        frog.escaped
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
      frog.abandoned = false;
      frog.pickupStork = null;
      frog.pickupTimer = null;
      frog.pickupDeparture = null;
      frog.pickupEnergySnapshot = null;
      frog.pickupDurationMs = null;
      frog.pickupAbortMarginPx = null;
      frog.gameObject.setVisible(false).disableInteractive();

      if (selectedFrog === frog) {
        selectedFrog = null;
      }

      console.log("FROG_ESCAPED");
      escapedCount += 1;
      addPersistentTrailerFrog(frog.id);
      console.assert(
        escapedCount === persistentTrailerFrogs.length,
        "TRAILER_FROG_COUNT_MISMATCH",
        {
          escapedCount,
          persistentCount: persistentTrailerFrogs.length,
        },
      );
      updateDebugHud();
    };

    const enableFrogInteraction = (frog: FrogState): void => {
      if (gameOver || frog.abandoned) {
        frog.gameObject.disableInteractive();
        return;
      }

      const visualWidth = frog.gameObject.width;
      const visualHeight = frog.gameObject.height;
      const hitWidth = Math.max(visualWidth * FROG_HIT_AREA_SCALE, 56);
      const hitHeight = Math.max(visualHeight * FROG_HIT_AREA_SCALE, 56);
      const hitArea = new Phaser.Geom.Ellipse(
        visualWidth / 2,
        visualHeight / 2,
        hitWidth,
        hitHeight,
      );

      frog.gameObject.setInteractive(hitArea, Phaser.Geom.Ellipse.Contains);
    };

    let permanentlyAbortStork = (
      _stork: Phaser.GameObjects.Arc,
      _beginDeparture: (
        rescueCompleted?: boolean,
        permanentlyLeave?: boolean,
      ) => void,
    ): void => {};

    const abortPickupNearCutter = (frog: FrogState, cutterY: number): void => {
      if (
        !frog.active ||
        frog.pickupStork === null ||
        frog.pickupTimer === null ||
        frog.pickupDeparture === null ||
        frog.pickupAbortMarginPx === null
      ) {
        return;
      }

      const distanceToCutter = cutterY - frog.gameObject.y;

      if (distanceToCutter > frog.pickupAbortMarginPx) {
        return;
      }

      const abortedStork = frog.pickupStork;
      const beginDeparture = frog.pickupDeparture;
      frog.pickupTimer.remove(false);
      frog.pickupTimer = null;
      frog.pickupStork = null;
      frog.pickupDeparture = null;
      frog.pickupEnergySnapshot = null;
      frog.pickupDurationMs = null;
      frog.pickupAbortMarginPx = null;
      frog.reserved = false;
      frog.abandoned = true;
      frog.selected = false;
      frog.gameObject.disableInteractive();

      if (selectedFrog === frog) {
        setSelectedFrog(null);
      }

      console.log("PICKUP_ABORTED_BY_CUTTER");
      permanentlyAbortStork(abortedStork, beginDeparture);
    };

    let updateThreatenedIdleStorks = (): void => {};
    let updateStorkEnergy = (_deltaSeconds: number): void => {};
    let updateRescueParametersHud = (): void => {};

    const updateFrogs = (_time = 0, delta = 0): void => {
      if (!usesPresentedFrameCallback && htmlVideoElement !== null) {
        this.presentedVideoTime = htmlVideoElement.currentTime;
      }

      if (!videoReady) {
        return;
      }

      const cutterMotion = getCutterMotion();
      const cutterY = cutterMotion.y;
      updateCutterDebugLine(cutterY);
      updateTrailerFrogPositions();
      refreshTrailerCalibrationDebug();

      for (const frog of frogs) {
        updateFrogPosition(frog);
        abortPickupNearCutter(frog, cutterY);
        checkFrogEscape(frog, cutterY);
      }

      updateThreatenedIdleStorks();
      updateStorkEnergy(delta / 1000);
      updateRescueParametersHud();

      if (trailerTrackMode) {
        drawTrackingPaths();
      }
    };

    const setSelectedFrog = (frog: FrogState | null): void => {
      for (const candidate of frogs) {
        candidate.selected = candidate === frog;
        candidate.gameObject.setStrokeStyle(
          candidate === frog ? 3 : 0,
          0xffff00,
        );
      }

      selectedFrog = frog;

      if (frog !== null) {
        this.tweens.add({
          targets: frog.gameObject,
          scale: 1.18,
          duration: 110,
          ease: "Sine.easeOut",
          yoyo: true,
        });
      }
    };

    let getEstimatedRescueTimeSeconds = (
      _frog: FrogState,
      _stork: Phaser.GameObjects.Arc,
    ): number => Number.POSITIVE_INFINITY;
    let evaluateFairSpawnCandidate = (
      _frog: FrogState,
      _videoTime: number,
    ): FairSpawnEvaluation | null => null;

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
      const maximumY = getCutterMotion().y - minimumCutterClearance;

      if (minimumX > maximumX || minimumY > maximumY) {
        return null;
      }

      const activeFrogs = frogs.filter((candidate) => candidate !== frog && candidate.active);

      for (let attempt = 0; attempt < MAX_FAIR_SPAWN_ATTEMPTS; attempt += 1) {
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
          frog.gameObject.setPosition(candidateX, candidateY);
          const videoTime = this.presentedVideoTime;
          const fairness = evaluateFairSpawnCandidate(frog, videoTime);

          if (fairness === null) {
            continue;
          }

          if (trailerTrackMode) {
            console.log("FAIR_FROG_SPAWN", {
              videoTime,
              timeUntilCutter: fairness.timeUntilCutter,
              requiredTime: fairness.requiredTime,
              chosenMargin:
                fairness.timeUntilCutter - fairness.requiredTime,
            });
          }

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
      frog.abandoned = false;
      frog.rescued = false;
      frog.escaped = false;
      frog.pickupStork = null;
      frog.pickupTimer = null;
      frog.pickupDeparture = null;
      frog.pickupEnergySnapshot = null;
      frog.pickupDurationMs = null;
      frog.pickupAbortMarginPx = null;
      frog.spawnPosition = spawnPosition;
      frog.spawnPresentedVideoTime = this.presentedVideoTime;
      updateFrogBasePosition(frog);
      frog.gameObject.setFillStyle(0x00aa44).setVisible(true);
      enableFrogInteraction(frog);
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
    const storkEnergyStates = new Map(
      storks.map((stork) => [
        stork,
        {
          energy: STORK_MAX_ENERGY,
          label: this.add
            .text(0, 0, `${STORK_MAX_ENERGY}%`, {
              color: "#ffffff",
              fontFamily: "Arial, sans-serif",
              fontSize: "13px",
              fontStyle: "bold",
              stroke: "#123d2b",
              strokeThickness: 3,
            })
            .setOrigin(0.5)
            .setDepth(2)
            .setVisible(false),
        },
      ]),
    );
    const homePositions = new Map<Phaser.GameObjects.Arc, Phaser.Math.Vector2>();
    const flyingStorks = new Set<Phaser.GameObjects.Arc>();
    const evacuatingStorks = new Set<Phaser.GameObjects.Arc>();
    const inactiveStorks = new Set<Phaser.GameObjects.Arc>();
    const departedStorks = new Set<Phaser.GameObjects.Arc>();
    const storkEnergyWasIdle = new Map(storks.map((stork) => [stork, true]));
    let selectedStork: Phaser.GameObjects.Arc | null = null;

    const useStorkEnergy = (stork: Phaser.GameObjects.Arc): void => {
      const state = storkEnergyStates.get(stork);

      if (state === undefined) {
        return;
      }

      const previousEnergy = state.energy;
      state.energy = Phaser.Math.Clamp(
        state.energy - STORK_ENERGY_COST_PER_RESCUE,
        0,
        STORK_MAX_ENERGY,
      );
      state.label.setText(`${Math.round(state.energy)}%`);
      console.log("STORK_ENERGY_USED", {
        storkId: storks.indexOf(stork),
        previousEnergy,
        newEnergy: state.energy,
      });
    };

    updateStorkEnergy = (deltaSeconds: number): void => {
      for (const stork of storks) {
        const state = storkEnergyStates.get(stork);
        const idle =
          !inactiveStorks.has(stork) &&
          !flyingStorks.has(stork) &&
          !evacuatingStorks.has(stork);
        const wasIdle = storkEnergyWasIdle.get(stork) ?? idle;

        if (state === undefined) {
          continue;
        }

        if (idle && !wasIdle) {
          console.log("STORK_ENERGY_REGEN_STARTED", {
            storkId: storks.indexOf(stork),
            energy: state.energy,
            regenPerSecond: STORK_ENERGY_REGEN_PER_SECOND,
          });
        }

        if (idle && state.energy < STORK_MAX_ENERGY) {
          state.energy = Phaser.Math.Clamp(
            state.energy + STORK_ENERGY_REGEN_PER_SECOND * deltaSeconds,
            0,
            STORK_MAX_ENERGY,
          );
        }

        state.label
          .setPosition(stork.x, stork.y - stork.displayHeight / 2 - 12)
          .setText(`${Math.round(state.energy)}%`)
          .setVisible(idle);
        storkEnergyWasIdle.set(stork, idle);
      }
    };

    updateRescueParametersHud = (): void => {
      const activePickup = frogs.find(
        (frog) =>
          frog.active &&
          frog.pickupStork !== null &&
          frog.pickupTimer !== null &&
          frog.pickupEnergySnapshot !== null &&
          frog.pickupDurationMs !== null &&
          frog.pickupAbortMarginPx !== null,
      );
      const displayedStork = selectedStork ?? activePickup?.pickupStork ?? null;

      if (displayedStork === null) {
        rescueParametersHud.setVisible(false);
        return;
      }

      const activePickupForStork =
        activePickup?.pickupStork === displayedStork ? activePickup : null;
      const energy =
        activePickupForStork?.pickupEnergySnapshot ??
        storkEnergyStates.get(displayedStork)?.energy ??
        STORK_MAX_ENERGY;
      const abortMargin =
        activePickupForStork?.pickupAbortMarginPx ??
        (abortMode === "energy"
          ? getStorkAbortMarginPx(energy)
          : CUTTER_ABORT_MARGIN_PX);
      const pickupDuration =
        activePickupForStork?.pickupDurationMs ??
        getStorkPickupDurationMs(energy);
      const formattedAbortMargin = Number.isInteger(abortMargin)
        ? abortMargin.toFixed(0)
        : abortMargin.toFixed(1);

      rescueParametersHud
        .setText(
          `Energy: ${Math.round(energy)}%\n` +
            `Abort: ${formattedAbortMargin} px\n` +
            `Pickup: ${(pickupDuration / 1000).toFixed(1)} s`,
        )
        .setVisible(true);
    };

    getEstimatedRescueTimeSeconds = (
      frog: FrogState,
      stork: Phaser.GameObjects.Arc,
    ): number => {
      const storkIndex = storks.indexOf(stork);
      const configuredFlightDurationSeconds =
        (storkLayouts[storkIndex]?.arrivalDuration ?? 900) / 1000;
      const flightDistance = Phaser.Math.Distance.Between(
        stork.x,
        stork.y,
        frog.gameObject.x,
        frog.gameObject.y,
      );
      const existingFlightSpeed =
        configuredFlightDurationSeconds > 0
          ? flightDistance / configuredFlightDurationSeconds
          : 0;
      const flightTime =
        existingFlightSpeed > 0
          ? flightDistance / existingFlightSpeed
          : configuredFlightDurationSeconds;
      const energy =
        storkEnergyStates.get(stork)?.energy ?? STORK_MAX_ENERGY;
      const currentPickupDuration =
        getStorkPickupDurationMs(energy) / 1000;

      return (
        flightTime +
        currentPickupDuration +
        FAIR_SPAWN_REACTION_TIME_SECONDS +
        FAIR_SPAWN_SELECTION_TIME_SECONDS +
        FAIR_SPAWN_EXTRA_BUFFER_SECONDS
      );
    };

    evaluateFairSpawnCandidate = (
      frog: FrogState,
      videoTime: number,
    ): FairSpawnEvaluation | null => {
      const availableStorks = storks.filter(
        (stork) =>
          !inactiveStorks.has(stork) &&
          !flyingStorks.has(stork) &&
          !evacuatingStorks.has(stork),
      );

      if (availableStorks.length === 0) {
        return null;
      }

      const requiredTime = Math.min(
        ...availableStorks.map((stork) =>
          getEstimatedRescueTimeSeconds(frog, stork),
        ),
      );
      const timeUntilCutter = getTimeUntilCutterSeconds(
        frog.gameObject.y,
        videoTime,
      );

      if (timeUntilCutter <= requiredTime) {
        return null;
      }

      return {
        timeUntilCutter,
        requiredTime,
      };
    };

    const isLateVehiclePhase = (videoTime: number): boolean =>
      videoTime >= WORLD_MOVEMENT_END_VIDEO_TIME;

    const getVehicleDangerCorridors = (
      videoTime: number,
    ): Phaser.Geom.Rectangle[] => {
      const videoBounds = video.getBounds();
      const trailerBounds = getTrailerBounds();
      const trackedCutterYNormalized = getCutterTrackedYNormalized(videoTime);
      const cutterY =
        trackedCutterYNormalized === null
          ? getCutterMotion().y
          : videoBounds.top + trackedCutterYNormalized * videoBounds.height;
      const cutterLeft =
        videoBounds.left +
        videoBounds.width * FROG_CORRIDOR_MIN_X_NORMALIZED;
      const cutterRight =
        videoBounds.left +
        videoBounds.width * FROG_CORRIDOR_MAX_X_NORMALIZED;
      const padding = STORK_LANDING_SAFETY_PADDING;

      return [
        new Phaser.Geom.Rectangle(
          trailerBounds.left - padding,
          trailerBounds.top - padding,
          trailerBounds.width + padding * 2,
          trailerBounds.height + padding * 2,
        ),
        new Phaser.Geom.Rectangle(
          cutterLeft - padding,
          cutterY - padding,
          cutterRight - cutterLeft + padding * 2,
          padding * 2,
        ),
      ];
    };

    const getStorkLandingFootprint = (
      x: number,
      y: number,
      stork: Phaser.GameObjects.Arc,
    ): Phaser.Geom.Rectangle =>
      new Phaser.Geom.Rectangle(
        x - stork.displayWidth / 2,
        y - stork.displayHeight / 2,
        stork.displayWidth,
        stork.displayHeight,
      );

    const isSafeStorkLandingPosition = (
      x: number,
      y: number,
      videoTime: number,
      landingStork: Phaser.GameObjects.Arc,
    ): boolean => {
      const videoBounds = video.getBounds();
      const storkHalfWidth = landingStork.displayWidth / 2;
      const landingFootprint = getStorkLandingFootprint(
        x,
        y,
        landingStork,
      );

      if (
        landingFootprint.left < videoBounds.left ||
        landingFootprint.right > videoBounds.right ||
        landingFootprint.top < videoBounds.top ||
        landingFootprint.bottom > videoBounds.bottom
      ) {
        return false;
      }

      if (tractorFrontTrackSamples.length > 0) {
        for (
          let secondsAhead = 0;
          secondsAhead <= STORK_DANGER_LOOKAHEAD_SECONDS;
          secondsAhead += STORK_DANGER_SAMPLE_STEP_SECONDS
        ) {
          const dangerBounds = getTractorDangerBounds(
            videoTime + secondsAhead,
            TRACTOR_LANDING_DANGER_PADDING,
          );

          if (
            dangerBounds !== null &&
            Phaser.Geom.Intersects.RectangleToRectangle(
              landingFootprint,
              dangerBounds,
            )
          ) {
            return false;
          }
        }
      } else {
        for (const corridor of getVehicleDangerCorridors(videoTime)) {
          if (
            Phaser.Geom.Intersects.RectangleToRectangle(
              landingFootprint,
              corridor,
            )
          ) {
            return false;
          }
        }
      }

      return storks.every(
        (otherStork) =>
          otherStork === landingStork ||
          inactiveStorks.has(otherStork) ||
          flyingStorks.has(otherStork) ||
          Phaser.Math.Distance.Between(x, y, otherStork.x, otherStork.y) >=
            storkHalfWidth * 2 + 10,
      );
    };

    const findSafeStorkLandingPosition = (
      preferredX: number,
      preferredY: number,
      videoTime: number,
      landingStork: Phaser.GameObjects.Arc,
    ): Phaser.Math.Vector2 | null => {
      const candidateOffsets = [
        [0, 0],
        [-60, 0],
        [60, 0],
        [-100, 0],
        [100, 0],
        [-60, -50],
        [60, -50],
        [-60, 50],
        [60, 50],
        [-100, -50],
        [100, -50],
        [-100, 50],
        [100, 50],
        [0, -50],
        [0, 50],
      ] as const;

      for (const [offsetX, offsetY] of candidateOffsets) {
        const x = preferredX + offsetX;
        const y = preferredY + offsetY;

        if (isSafeStorkLandingPosition(x, y, videoTime, landingStork)) {
          return new Phaser.Math.Vector2(x, y);
        }
      }

      return null;
    };

    const findLeftSafeStorkLandingPosition = (
      preferredY: number,
      videoTime: number,
      landingStork: Phaser.GameObjects.Arc,
    ): Phaser.Math.Vector2 | null => {
      const videoBounds = video.getBounds();
      const halfWidth = landingStork.displayWidth / 2;
      const predictedDangerBounds: Phaser.Geom.Rectangle[] = [];

      for (
        let secondsAhead = 0;
        secondsAhead <= STORK_DANGER_LOOKAHEAD_SECONDS;
        secondsAhead += STORK_DANGER_SAMPLE_STEP_SECONDS
      ) {
        const dangerBounds = getTractorDangerBounds(
          videoTime + secondsAhead,
          TRACTOR_LANDING_DANGER_PADDING,
        );

        if (dangerBounds !== null) {
          predictedDangerBounds.push(dangerBounds);
        }
      }

      if (predictedDangerBounds.length === 0) {
        return null;
      }

      const leftmostDangerX = Math.min(
        ...predictedDangerBounds.map((bounds) => bounds.left),
      );
      const maximumLeftLandingX = Math.min(
        videoBounds.right - halfWidth,
        leftmostDangerX - halfWidth - 10,
      );
      const xCandidates = [
        videoBounds.left + halfWidth + 10,
        videoBounds.left + halfWidth + 70,
        maximumLeftLandingX,
      ];
      const yOffsets = [0, -60, 60, -120, 120, -180, 180] as const;

      for (const candidateX of xCandidates) {
        for (const offsetY of yOffsets) {
          const candidateY = preferredY + offsetY;

          if (
            candidateX <= maximumLeftLandingX &&
            isSafeStorkLandingPosition(
              candidateX,
              candidateY,
              videoTime,
              landingStork,
            )
          ) {
            return new Phaser.Math.Vector2(candidateX, candidateY);
          }
        }
      }

      return null;
    };

    const isStorkThreatenedByTractor = (
      stork: Phaser.GameObjects.Arc,
      videoTime: number,
    ): boolean => {
      const footprint = getStorkLandingFootprint(stork.x, stork.y, stork);

      for (
        let secondsAhead = 0;
        secondsAhead <= STORK_DANGER_LOOKAHEAD_SECONDS;
        secondsAhead += STORK_DANGER_SAMPLE_STEP_SECONDS
      ) {
        const dangerBounds = getTractorDangerBounds(
          videoTime + secondsAhead,
          TRACTOR_EVACUATION_DANGER_PADDING,
        );

        if (
          dangerBounds !== null &&
          Phaser.Geom.Intersects.RectangleToRectangle(
            footprint,
            dangerBounds,
          )
        ) {
          return true;
        }
      }

      return false;
    };

    const beginStorkEvacuation = (stork: Phaser.GameObjects.Arc): void => {
      if (
        inactiveStorks.has(stork) ||
        flyingStorks.has(stork) ||
        evacuatingStorks.has(stork)
      ) {
        return;
      }

      const storkId = storks.indexOf(stork);
      const startVideoTime =
        htmlVideoElement?.currentTime ?? this.presentedVideoTime;
      let deferredLogged = false;

      flyingStorks.add(stork);
      evacuatingStorks.add(stork);
      storkEnergyStates.get(stork)?.label.setVisible(false);
      selectStork(null);
      console.log("STORK_TRACTOR_EVADE_STARTED", {
        storkId,
        videoTime: startVideoTime,
        currentX: stork.x,
        currentY: stork.y,
      });

      const tryLanding = (): void => {
        if (!sceneActive || !evacuatingStorks.has(stork)) {
          return;
        }

        const videoTime =
          htmlVideoElement?.currentTime ?? this.presentedVideoTime;
        const safeLanding = findLeftSafeStorkLandingPosition(
          stork.y,
          videoTime,
          stork,
        );

        if (safeLanding === null) {
          if (!deferredLogged) {
            deferredLogged = true;
            console.log("STORK_TRACTOR_EVADE_DEFERRED", {
              storkId,
              videoTime,
            });
          }

          this.time.delayedCall(250, tryLanding);
          return;
        }

        this.tweens.add({
          targets: stork,
          x: safeLanding.x,
          y: safeLanding.y,
          duration: 700,
          ease: "Sine.easeInOut",
          onComplete: () => {
            const landingVideoTime =
              htmlVideoElement?.currentTime ?? this.presentedVideoTime;

            if (
              !isSafeStorkLandingPosition(
                safeLanding.x,
                safeLanding.y,
                landingVideoTime,
                stork,
              )
            ) {
              tryLanding();
              return;
            }

            flyingStorks.delete(stork);
            evacuatingStorks.delete(stork);
            console.log("STORK_TRACTOR_EVADE_LANDING", {
              storkId,
              safeX: safeLanding.x,
              safeY: safeLanding.y,
              videoTime: landingVideoTime,
            });
          },
        });
      };

      const videoBounds = video.getBounds();
      this.tweens.add({
        targets: stork,
        x: videoBounds.left - stork.displayWidth,
        y: Phaser.Math.Clamp(
          stork.y - 50,
          videoBounds.top + stork.displayHeight / 2,
          videoBounds.bottom - stork.displayHeight / 2,
        ),
        duration: 500,
        ease: "Sine.easeIn",
        onComplete: tryLanding,
      });
    };

    updateThreatenedIdleStorks = (): void => {
      if (
        tractorFrontTrackSamples.length === 0 ||
        !simulationStarted ||
        !videoReady
      ) {
        return;
      }

      const videoTime =
        htmlVideoElement?.currentTime ?? this.presentedVideoTime;

      for (const stork of storks) {
        if (
          !flyingStorks.has(stork) &&
          !evacuatingStorks.has(stork) &&
          !inactiveStorks.has(stork) &&
          isStorkThreatenedByTractor(stork, videoTime)
        ) {
          beginStorkEvacuation(stork);
        }
      }
    };

    const selectStork = (stork: Phaser.GameObjects.Arc | null): void => {
      selectedStork?.setStrokeStyle();
      selectedStork = stork;
      selectedStork?.setStrokeStyle(4, 0xffff00);

      if (stork !== null) {
        const energyLabel = storkEnergyStates.get(stork)?.label;

        if (energyLabel !== undefined) {
          this.tweens.killTweensOf(energyLabel);
          energyLabel.setColor("#ffff66").setScale(1);
          this.tweens.add({
            targets: energyLabel,
            scale: 1.25,
            duration: 100,
            yoyo: true,
            onComplete: () => {
              energyLabel.setColor("#ffffff").setScale(1);
            },
          });
        }
      }
    };

    permanentlyAbortStork = (
      stork: Phaser.GameObjects.Arc,
      beginDeparture: (
        rescueCompleted?: boolean,
        permanentlyLeave?: boolean,
      ) => void,
    ): void => {
      if (inactiveStorks.has(stork)) {
        return;
      }

      inactiveStorks.add(stork);
      evacuatingStorks.delete(stork);
      stork.disableInteractive();
      storkEnergyStates.get(stork)?.label.setVisible(false);

      if (selectedStork === stork) {
        selectStork(null);
      }

      const remainingActiveStorks = storks.filter(
        (candidate) => !inactiveStorks.has(candidate),
      ).length;
      console.log("STORK_ABORTED", {
        storkId: storks.indexOf(stork),
        remainingActiveStorks,
      });

      const speechBubble = this.add
        .text(stork.x, stork.y - stork.displayHeight / 2 - 18, "Na to nemám... Bye bye!", {
          backgroundColor: "#ffffff",
          color: "#222222",
          fontFamily: "Arial, sans-serif",
          fontSize: "14px",
          padding: { x: 8, y: 5 },
        })
        .setOrigin(0.5, 1)
        .setDepth(220)
        .setScrollFactor(0);
      storkAbortSpeechBubbles.add(speechBubble);

      this.time.delayedCall(1200, () => {
        storkAbortSpeechBubbles.delete(speechBubble);
        speechBubble.destroy();

        if (sceneActive) {
          beginDeparture(false, true);
        }
      });
    };

    const spawnFrogIfPossible = (): void => {
      if (gameOver) {
        return;
      }

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
        frog.abandoned ||
        frog.rescued ||
        frog.escaped ||
        frog.id !== targetFrogId ||
        frog.pickupStork !== stork
      ) {
        return false;
      }

      const pickupX = frog.gameObject.x;
      const pickupY = frog.gameObject.y;
      frog.active = false;
      frog.rescued = true;
      frog.selected = false;
      frog.reserved = false;
      frog.pickupStork = null;
      frog.pickupTimer = null;
      frog.pickupDeparture = null;
      frog.pickupEnergySnapshot = null;
      frog.pickupDurationMs = null;
      frog.pickupAbortMarginPx = null;
      frog.gameObject.setVisible(false).disableInteractive();

      if (selectedFrog === frog) {
        setSelectedFrog(null);
      }

      console.log("RESCUE_COMPLETE");
      rescuedCount += 1;
      updateDebugHud();
      showPickupSuccessFeedback(pickupX, pickupY);

      return true;
    };

    const startPickup = (
      frog: FrogState,
      targetFrogId: number,
      stork: Phaser.GameObjects.Arc,
      beginDeparture: (
        rescueCompleted?: boolean,
        permanentlyLeave?: boolean,
      ) => void,
    ): boolean => {
      if (
        !frog.active ||
        frog.abandoned ||
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
      frog.pickupDeparture = beginDeparture;
      const pickupEnergySnapshot =
        storkEnergyStates.get(stork)?.energy ?? STORK_MAX_ENERGY;
      const pickupDurationMs = getStorkPickupDurationMs(
        pickupEnergySnapshot,
      );
      const pickupAbortMarginPx =
        abortMode === "energy"
          ? getStorkAbortMarginPx(pickupEnergySnapshot)
          : CUTTER_ABORT_MARGIN_PX;
      frog.pickupEnergySnapshot = pickupEnergySnapshot;
      frog.pickupDurationMs = pickupDurationMs;
      frog.pickupAbortMarginPx = pickupAbortMarginPx;
      stork.setPosition(frog.gameObject.x, frog.gameObject.y);
      console.log("STORK_RESCUE_PARAMETERS", {
        storkId: storks.indexOf(stork),
        energy: pickupEnergySnapshot,
        abortMode,
        abortMarginPx: pickupAbortMarginPx,
        pickupDurationMs,
      });

      frog.pickupTimer = this.time.delayedCall(pickupDurationMs, () => {
        frog.pickupTimer = null;

        if (
          frog.id !== targetFrogId ||
          frog.pickupStork !== stork ||
          !frog.active
        ) {
          return;
        }

        const pickupCompleted = completeRescue(frog, targetFrogId, stork);

        if (pickupCompleted) {
          console.log("PICKUP_COMPLETED");
        }

        beginDeparture(pickupCompleted);
      });

      return true;
    };

    const releaseFrogReservation = (frog: FrogState, targetFrogId: number): void => {
      if (frog.active && frog.id === targetFrogId && frog.pickupStork === null) {
        frog.reserved = false;
        enableFrogInteraction(frog);
      }
    };

    const launchStork = (stork: Phaser.GameObjects.Arc, frog: FrogState): void => {
      if (
        gameOver ||
        inactiveStorks.has(stork) ||
        flyingStorks.has(stork) ||
        !frog.active ||
        frog.abandoned ||
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
      let landingDeferredLogged = false;
      let rescueEnergyCharged = false;

      flyingStorks.add(stork);
      storkEnergyStates.get(stork)?.label.setVisible(false);
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
          const videoTime = htmlVideoElement?.currentTime ?? this.presentedVideoTime;

          if (
            tractorFrontTrackSamples.length > 0 ||
            isLateVehiclePhase(videoTime)
          ) {
            const safeLanding = findSafeStorkLandingPosition(
              home.x,
              home.y,
              videoTime,
              stork,
            );

            if (safeLanding === null) {
              if (!landingDeferredLogged) {
                landingDeferredLogged = true;
                console.log("STORK_LANDING_DEFERRED", {
                  storkId: storks.indexOf(stork),
                  videoTime,
                });
              }

              this.time.delayedCall(250, returnToStart);
              return;
            }

            if (safeLanding.x !== home.x || safeLanding.y !== home.y) {
              console.log("STORK_LANDING_REROUTED", {
                storkId: storks.indexOf(stork),
                preferredX: home.x,
                preferredY: home.y,
                safeX: safeLanding.x,
                safeY: safeLanding.y,
                videoTime,
              });
            }

            stork.setPosition(safeLanding.x, safeLanding.y);
          } else {
            stork.setPosition(home.x, home.y);
          }
        }

        flyingStorks.delete(stork);
        removeDebugMarkers();

        if (selectedStork === stork) {
          selectStork(null);
        }
      };

      const beginDeparture = (
        rescueCompleted = false,
        permanentlyLeave = false,
      ): void => {
        this.tweens.add({
          targets: stork,
          x: this.scale.gameSize.width + stork.displayWidth,
          y: -stork.displayHeight,
          duration: 700,
          ease: "Sine.easeIn",
          onComplete: () => {
            if (rescueCompleted && !rescueEnergyCharged) {
              rescueEnergyCharged = true;
              useStorkEnergy(stork);
            }

            if (permanentlyLeave) {
              flyingStorks.delete(stork);
              departedStorks.add(stork);
              stork.setVisible(false);
              removeDebugMarkers();

              if (
                storks.every((candidate) => departedStorks.has(candidate))
              ) {
                triggerGameOver();
              }

              return;
            }

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
        if (
          gameOver ||
          !frog.active ||
          frog.abandoned ||
          frog.reserved ||
          frog.pickupStork !== null
        ) {
          return;
        }

        if (frog.selected || selectedFrog === frog) {
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
          !gameOver &&
          !inactiveStorks.has(stork) &&
          !flyingStorks.has(stork) &&
          targetFrog !== null &&
          targetFrog.active &&
          !targetFrog.abandoned &&
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

      abortMarginDebugUi.setPosition(gameSize.width - 12, 24);
      trailerCalibrationDebugPanel.setPosition(gameSize.width - 8, 62);
      resizeStartupOverlay();
      resizeGameOverOverlay();
      video.setPosition(centerX, centerY);

      if (video.width > 0 && video.height > 0) {
        const containScale = Math.min(
          gameSize.width / video.width,
          gameSize.height / video.height,
        );
        video.setScale(containScale);
        const resizedVideoBounds = video.getBounds();
        trailerTrackInputOverlay
          .setPosition(resizedVideoBounds.left, resizedVideoBounds.top)
          .setSize(resizedVideoBounds.width, resizedVideoBounds.height);

        if (trailerTrackMode) {
          trailerTrackInputOverlay.setInteractive();
        }

        updateTrailerFrogPositions();
        drawTrackingPaths();

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

    startSimulationIfReady = (): void => {
      if (
        !sceneActive ||
        simulationStarted ||
        !videoPlaybackStarted ||
        !videoFramePresented
      ) {
        return;
      }

      simulationStarted = true;
      resizeContent(this.scale.gameSize);

      for (let count = 0; count < INITIAL_FROG_COUNT; count += 1) {
        spawnFrogIfPossible();
      }

      frogSpawnTimer = this.time.addEvent({
        delay: FROG_SPAWN_INTERVAL_MS,
        loop: true,
        callback: spawnFrogIfPossible,
      });
    };

    video.once(Phaser.GameObjects.Events.VIDEO_CREATED, () => {
      const htmlVideo = video.video;

      if (htmlVideo !== null) {
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

      videoFramePresented = true;
      startSimulationIfReady();
    });
    this.scale.on(Phaser.Scale.Events.RESIZE, resizeContent);
    this.events.on(Phaser.Scenes.Events.UPDATE, updateFrogs);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      sceneActive = false;
      frogSpawnTimer?.remove(false);
      frogSpawnTimer = null;
      htmlVideoElement?.removeEventListener("canplay", handleCanPlay);
      htmlVideoElement?.removeEventListener("ended", handleVideoEnded);
      destroyStartupOverlay();
      destroyTrailerCameoObjects();

      for (const speechBubble of storkAbortSpeechBubbles) {
        speechBubble.destroy();
      }

      storkAbortSpeechBubbles.clear();
      gameOverOverlayBackground?.destroy();
      gameOverOverlayText?.destroy();
      gameOverOverlayBackground = null;
      gameOverOverlayText = null;

      for (const feedbackText of pickupFeedbackTexts) {
        this.tweens.killTweensOf(feedbackText);
        feedbackText.destroy();
      }

      pickupFeedbackTexts.clear();
      abortMarginDebugUi.destroy(true);
      trailerCalibrationDebugPanel.destroy(true);
      trailerCalibrationDebugRectangle.destroy();
      trailerCornerPreviewGraphics.destroy();
      trailerTrackInputOverlay.removeAllListeners();
      trailerTrackInputOverlay.destroy();
      trailerTrackPathGraphics.destroy();
      trailerBottomRightPathGraphics.destroy();
      cutterTrackPathGraphics.destroy();
      tractorTrackPathGraphics.destroy();
      tractorDangerGraphics.destroy();
      cutterDebugLine.destroy();
      debugHud.destroy();
      rescueParametersHud.destroy();

      for (const frog of frogs) {
        frog.pickupTimer?.remove(false);
        frog.pickupTimer = null;
        frog.pickupStork = null;
        frog.pickupDeparture = null;
        frog.pickupEnergySnapshot = null;
        frog.pickupDurationMs = null;
        frog.pickupAbortMarginPx = null;
        frog.gameObject.removeAllListeners();
        frog.gameObject.destroy();
      }

      for (const state of storkEnergyStates.values()) {
        this.tweens.killTweensOf(state.label);
        state.label.destroy();
      }

      storkEnergyStates.clear();

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
    attemptVideoPlayback("autoplay");
  }

  private handleShutdown(): void {
    this.context?.events.removeAllListeners();
    this.context = null;
  }
}
