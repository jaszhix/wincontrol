/// <reference types="node" />

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

export {
  exc,
  getPhysicalCoreCount
};