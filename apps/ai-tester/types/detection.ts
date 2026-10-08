export type Detection = {
  time: number;
  x: number;
  y: number;
  w: number;
  h: number;
  class: number;
  label: string;
  confidence: number;
};

export type DetectResponse = {
  ok: boolean;
  detections: Detection[];
  meta: {
    stderr: string;
  };
};

export type RenderRect = {
  stageW: number;
  stageH: number;
  dispX: number;
  dispY: number;
  dispW: number;
  dispH: number;
  sx: number;
  sy: number;
  natW: number;
  natH: number;
};

export type VideoMeta = {
  w: number;
  h: number;
};

export type DetectionStats = {
  total: number;
  framesSampled: number;
  byLabel: Array<[string, number]>;
};
