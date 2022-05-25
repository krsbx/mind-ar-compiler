import * as ICompiler from './compiler';
import * as IController from './controller';
import * as IEstimation from './estimation';
import * as IMatching from './matching';
import * as ITracker from './tracker';

interface ControllerConstructor {
  inputWidth: number;
  inputHeight: number;
  onUpdate?: ((data: IOnUpdate) => void) | null;
  debugMode?: boolean;
  maxTrack?: number;
  warmupTolerance?: number | null;
  missTolerance?: number | null;
  filterMinCF?: number | null;
  filterBeta?: number | null;
}

interface IAnchor {
  group: THREE.Group;
  targetIndex: number;
  onTargetFound: (() => void) | null;
  onTargetLost: (() => void) | null;
  css: boolean;
  visible: boolean;
}

export type {
  ICompiler,
  IController,
  IEstimation,
  IMatching,
  ITracker,
  ControllerConstructor,
  IAnchor,
};
