import sharp from 'sharp';
// import { Compiler } from './compiler';

// const compiler = new Compiler();

const main = async () => {
  const img = sharp('../assets/batman.jpg');

  console.log(img);

  // await compiler.compileImageTargets([img], )

  // await compiler.exportData();
};

main();
