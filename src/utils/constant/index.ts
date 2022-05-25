// All Constant being used in Image Target are stored in here
import * as detector from './detector';
import * as freak from './freak';
import * as matching from './matching';
import * as tracker from './tracker';

const DEFAULT_WORKER = {
  COMPILER: new Worker('/src/image-target/compiler.worker.ts', { type: 'module' }),
};

const IS_PRODUCTION = process.env.NODE_ENV === 'production';

export { detector, freak, matching, tracker, DEFAULT_WORKER, IS_PRODUCTION };
