import { GPGPUProgram } from '@tensorflow/tfjs-backend-webgl';

const applyPrune = (extremaHeight: number, extremaWidth: number) => {
  const kernel: GPGPUProgram = {
    variableNames: ['extrema'],
    outputShape: [Math.floor(extremaHeight / 2), Math.floor(extremaWidth / 2)],
    userCode: `
	    void main() {
	      ivec2 coords = getOutputCoords();
	      int y = coords[0] * 2;
	      int x = coords[1] * 2;

	      float location = 0.0;
	      float values = getExtrema(y, x);

	      if (getExtrema(y+1, x) != 0.0) {
	        location = 1.0;
		values = getExtrema(y+1, x);
	      }
	      else if (getExtrema(y, x+1) != 0.0) {
	        location = 2.0;
		values = getExtrema(y, x+1);
	      }
	      else if (getExtrema(y+1, x+1) != 0.0) {
	        location = 3.0;
		values = getExtrema(y+1, x+1);
	      }

	      if (values < 0.0) {
	        setOutput(location * -1000.0 + values);
	      } else {
	        setOutput(location * 1000.0 + values);
	      }
	    }
	  `,
  };

  return kernel;
};

export default applyPrune;
