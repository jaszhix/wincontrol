// @ts-nocheck
import fs from 'fs-extra';
import path from 'path'
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
  .then(() => copyFile('node_modules/ffi/build/Release/ffi_bindings.node', 'node_modules/ffi/build/Release/ffi_bindings.n'))
  .then(() => copyFile('node_modules/iconv/build/Release/iconv.node', 'node_modules/iconv/build/Release/iconv.n'))
  .then(() => copyFile('node_modules/ref/build/Release/binding.node', 'node_modules/ref/build/Release/binding.n'))
  .then(() => copyFile('node_modules/process-list/build/Release/processlist.node', 'node_modules/process-list/build/Release/processlist.n'))
  .then(() => exec(['./dist/index.js',/*  '--debug', */ '-c',  'package.json', '-t', 'node12-win', '-o', './staging/wincontrol']))
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
    console.log(e)
  });