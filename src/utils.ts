/// <reference types="node" />

import {createReadStream, createWriteStream} from 'fs';
import {exec} from 'child_process';
import {execOptions} from './constants';

const exc = (cmd): Promise<any> => {
  return new Promise((resolve, reject) => {
    exec(cmd, execOptions, (err, stdout, stderr) => {
      if (err) {
        err.message += stderr;
        return reject(err);
      }

      return resolve(stdout.toString().trim());
    });
  });
};

const getPhysicalCoreCount = (): Promise<any> => {
  return new Promise((resolve, reject) => {
    exc('WMIC CPU Get NumberOfCores').then((stdout) => {
      const match = stdout.match(/\d+/g);

      if (match) return resolve(parseInt(match[0]));

      return reject(new Error('getPhysicalCoreCount: Unable to get the physical core count.'));
    }).catch((e) => reject(e));
  });
};

const copyFile = (source, target): Promise<any> => {
  return new Promise((resolve, reject) => {
    let finished = false;

    const done = (err?) => {
      if (!finished) {
        if (err) reject(err);
        else resolve();

        finished = true;
      }
    }

    let read = createReadStream(source);
    read.on('error', function(err) {
      done(err);
    });
    let write = createWriteStream(target);
    write.on('error', function(err) {
      done(err);
    });
    write.on('close', function(ex) {
      done();
    });
    read.pipe(write);
  });
}

export {
  exc,
  getPhysicalCoreCount,
  copyFile,
};