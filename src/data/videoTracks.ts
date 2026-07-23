export interface TrailerTrackSample {
  videoTime: number;
  xNormalized: number;
  yNormalized: number;
}

export interface CutterTrackSample {
  videoTime: number;
  yNormalized: number;
}

export interface TractorFrontTrackSample {
  videoTime: number;
  xNormalized: number;
  yNormalized: number;
}

export type TrailerCornerSample = TrailerTrackSample;

export const TRAILER_TRACK_SAMPLES: TrailerTrackSample[] = [
  { videoTime: 2.442, xNormalized: 0.225100, yNormalized: 0.749608 },
  { videoTime: 3.518, xNormalized: 0.211146, yNormalized: 0.744113 },
  { videoTime: 7.525, xNormalized: 0.202773, yNormalized: 0.744898 },
  { videoTime: 9.649, xNormalized: 0.191610, yNormalized: 0.740973 },
  { videoTime: 13.625, xNormalized: 0.191610, yNormalized: 0.736264 },
  { videoTime: 17.179, xNormalized: 0.183237, yNormalized: 0.729984 },
  { videoTime: 20.057, xNormalized: 0.181842, yNormalized: 0.713501 },
  { videoTime: 22.139, xNormalized: 0.186028, yNormalized: 0.645997 },
  { videoTime: 23.172, xNormalized: 0.186028, yNormalized: 0.607535 },
  { videoTime: 24.042, xNormalized: 0.186028, yNormalized: 0.567504 },
  { videoTime: 25.168, xNormalized: 0.179051, yNormalized: 0.527473 },
  { videoTime: 26.086, xNormalized: 0.183237, yNormalized: 0.486656 },
  { videoTime: 27.782, xNormalized: 0.187424, yNormalized: 0.434851 },
  { videoTime: 29.452, xNormalized: 0.191610, yNormalized: 0.365777 },
  { videoTime: 31.073, xNormalized: 0.187424, yNormalized: 0.301413 },
  { videoTime: 32.624, xNormalized: 0.186028, yNormalized: 0.237049 },
  { videoTime: 34.092, xNormalized: 0.187424, yNormalized: 0.184458 },
  { videoTime: 35.375, xNormalized: 0.188819, yNormalized: 0.131868 },
  { videoTime: 36.828, xNormalized: 0.190215, yNormalized: 0.076923 },
  { videoTime: 38.168, xNormalized: 0.183237, yNormalized: 0.022763 },
];

export const TRAILER_BOTTOM_RIGHT_SAMPLES: TrailerCornerSample[] = [
  { videoTime: 7.209, xNormalized: 0.328362, yNormalized: 0.937991 },
  { videoTime: 10.028, xNormalized: 0.322780, yNormalized: 0.930926 },
  { videoTime: 12.625, xNormalized: 0.311617, yNormalized: 0.927002 },
  { videoTime: 15.844, xNormalized: 0.306035, yNormalized: 0.916797 },
  { videoTime: 18.162, xNormalized: 0.303244, yNormalized: 0.915228 },
  { videoTime: 19.631, xNormalized: 0.303244, yNormalized: 0.911303 },
  { videoTime: 20.802, xNormalized: 0.306035, yNormalized: 0.890110 },
  { videoTime: 21.623, xNormalized: 0.308826, yNormalized: 0.859498 },
  { videoTime: 22.557, xNormalized: 0.311617, yNormalized: 0.806907 },
  { videoTime: 23.672, xNormalized: 0.311617, yNormalized: 0.772370 },
  { videoTime: 25.075, xNormalized: 0.308826, yNormalized: 0.719780 },
  { videoTime: 26.305, xNormalized: 0.308826, yNormalized: 0.673469 },
  { videoTime: 27.353, xNormalized: 0.306035, yNormalized: 0.633438 },
  { videoTime: 28.320, xNormalized: 0.303244, yNormalized: 0.593407 },
  { videoTime: 29.675, xNormalized: 0.306035, yNormalized: 0.549451 },
  { videoTime: 31.516, xNormalized: 0.307431, yNormalized: 0.474097 },
  { videoTime: 33.231, xNormalized: 0.303244, yNormalized: 0.405024 },
  { videoTime: 34.287, xNormalized: 0.310222, yNormalized: 0.370487 },
  { videoTime: 35.702, xNormalized: 0.307431, yNormalized: 0.315542 },
  { videoTime: 36.901, xNormalized: 0.306035, yNormalized: 0.262951 },
  { videoTime: 37.992, xNormalized: 0.306035, yNormalized: 0.225275 },
  { videoTime: 39.079, xNormalized: 0.308826, yNormalized: 0.185243 },
  { videoTime: 39.807, xNormalized: 0.308826, yNormalized: 0.150706 },
  { videoTime: 40.850, xNormalized: 0.306035, yNormalized: 0.114600 },
  { videoTime: 41.731, xNormalized: 0.306035, yNormalized: 0.075353 },
  { videoTime: 42.534, xNormalized: 0.306035, yNormalized: 0.046311 },
  { videoTime: 43.459, xNormalized: 0.306035, yNormalized: 0.009419 },
];

export const CUTTER_TRACK_SAMPLES: CutterTrackSample[] = [
  { videoTime: 3.432, yNormalized: 0.621664 },
  { videoTime: 4.669, yNormalized: 0.615385 },
  { videoTime: 8.504, yNormalized: 0.615385 },
  { videoTime: 11.005, yNormalized: 0.606750 },
  { videoTime: 13.802, yNormalized: 0.611460 },
  { videoTime: 15.349, yNormalized: 0.616954 },
  { videoTime: 17.013, yNormalized: 0.613030 },
  { videoTime: 18.592, yNormalized: 0.605181 },
  { videoTime: 19.721, yNormalized: 0.596546 },
  { videoTime: 20.680, yNormalized: 0.583987 },
  { videoTime: 21.342, yNormalized: 0.552590 },
  { videoTime: 22.076, yNormalized: 0.529042 },
  { videoTime: 22.894, yNormalized: 0.527473 },
  { videoTime: 23.615, yNormalized: 0.508634 },
  { videoTime: 24.357, yNormalized: 0.481162 },
  { videoTime: 25.072, yNormalized: 0.456829 },
  { videoTime: 25.875, yNormalized: 0.430141 },
  { videoTime: 26.496, yNormalized: 0.406593 },
  { videoTime: 27.332, yNormalized: 0.368917 },
  { videoTime: 28.444, yNormalized: 0.333595 },
  { videoTime: 29.992, yNormalized: 0.281005 },
  { videoTime: 31.144, yNormalized: 0.218995 },
  { videoTime: 32.719, yNormalized: 0.175824 },
  { videoTime: 33.739, yNormalized: 0.142857 },
  { videoTime: 34.716, yNormalized: 0.113815 },
  { videoTime: 35.600, yNormalized: 0.087127 },
  { videoTime: 36.801, yNormalized: 0.040031 },
  { videoTime: 37.760, yNormalized: 0.016484 },
];

export const TRACTOR_FRONT_TRACK_SAMPLES: TractorFrontTrackSample[] = [
  { videoTime: 5.320, xNormalized: 0.211146, yNormalized: 0.483516 },
  { videoTime: 8.055, xNormalized: 0.213937, yNormalized: 0.486656 },
  { videoTime: 10.370, xNormalized: 0.211146, yNormalized: 0.478807 },
  { videoTime: 12.715, xNormalized: 0.218123, yNormalized: 0.471743 },
  { videoTime: 14.514, xNormalized: 0.206960, yNormalized: 0.470958 },
  { videoTime: 16.278, xNormalized: 0.206960, yNormalized: 0.464678 },
  { videoTime: 18.223, xNormalized: 0.208355, yNormalized: 0.470958 },
  { videoTime: 19.714, xNormalized: 0.208355, yNormalized: 0.458399 },
  { videoTime: 20.830, xNormalized: 0.211146, yNormalized: 0.442700 },
  { videoTime: 21.606, xNormalized: 0.211146, yNormalized: 0.408163 },
  { videoTime: 22.470, xNormalized: 0.206960, yNormalized: 0.374411 },
  { videoTime: 23.305, xNormalized: 0.205564, yNormalized: 0.342229 },
  { videoTime: 24.074, xNormalized: 0.205564, yNormalized: 0.317111 },
  { videoTime: 24.971, xNormalized: 0.216728, yNormalized: 0.281790 },
  { videoTime: 25.980, xNormalized: 0.225100, yNormalized: 0.241758 },
  { videoTime: 26.896, xNormalized: 0.216728, yNormalized: 0.212716 },
  { videoTime: 27.710, xNormalized: 0.226496, yNormalized: 0.178964 },
  { videoTime: 28.486, xNormalized: 0.215332, yNormalized: 0.153846 },
  { videoTime: 29.238, xNormalized: 0.211146, yNormalized: 0.127159 },
  { videoTime: 29.965, xNormalized: 0.213937, yNormalized: 0.097331 },
  { videoTime: 30.666, xNormalized: 0.219519, yNormalized: 0.071429 },
  { videoTime: 31.418, xNormalized: 0.219519, yNormalized: 0.032967 },
  { videoTime: 32.128, xNormalized: 0.219519, yNormalized: 0.007064 },
];
