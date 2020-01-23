import fs from 'fs-extra';
import del from 'del';
import {exec} from 'pkg';
import archiver from 'archiver';
// @ts-ignore
import packageJSON from './package.json';
import {copyFile, exc} from './src/utils';

fs.ensureDir('./staging')
  .then(() => fs.ensureDir('./release'))
  .then(() => del(['./dist/**', '!./dist', './staging/**', '!./staging/']))
  .then(() => exc('tsc --project ./tsconfig.json'))
  .then(() => fs.ensureDir('./staging/node_modules/ffi/build/Release/'))
  .then(() => fs.ensureDir('./staging/node_modules/iconv/build/Release/'))
  .then(() => fs.ensureDir('./staging/node_modules/ref/build/Release/'))
  .then(() => fs.ensureDir('./staging/node_modules/process-list/build/Release/'))
  .then(() => copyFile('./config.yaml', './staging/config.yaml'))
  .then(() => copyFile('node_modules/ffi/build/Release/ffi_bindings.node', './staging/node_modules/ffi/build/Release/ffi_bindings.node'))
  .then(() => copyFile('node_modules/iconv/build/Release/iconv.node', './staging/node_modules/iconv/build/Release/iconv.node'))
  .then(() => copyFile('node_modules/ref/build/Release/binding.node', './staging/node_modules/ref/build/Release/binding.node'))
  .then(() => copyFile('node_modules/process-list/build/Release/processlist.node', './staging/node_modules/process-list/build/Release/processlist.node'))
  .then(() => copyFile('./bin/elevate.exe', './staging/elevate.exe'))
  .then(() => copyFile('./bin/start.vbs', './staging/start.vbs'))
  .then(() => copyFile('./bin/runWinControl.vbs', './staging/runWinControl.vbs'))
  .then(() => exec(['./dist/index.js', '-t', 'node12-win', '-o', './staging/wincontrol']))
  .then(() => {
    const output = fs.createWriteStream(`./release/wincontrol-${packageJSON.version}.zip`);
    // @ts-ignore
    const archive = archiver('zip', {
      zlib: {level: 9} // Sets the compression level.
    });
    archive.pipe(output);
    archive.directory('staging/', false);
    return archive.finalize();
  })
  .then(() => console.log('Finished'))
  .catch((e) => {
    throw e;
  });