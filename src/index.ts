import canvas from 'canvas';
import Compiler from './compiler';

const compiler = new Compiler();

const main = async () => {
  const image = await canvas.loadImage('./assets/batman.jpg');

  await compiler.compileImageTargets([image], (progress) => {
    console.log(progress);
  });

  // await compiler.exportData();
};

main();
