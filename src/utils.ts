/// <reference types="node" />

import {EOL} from 'os';
import fs from 'fs-extra';
import {exec} from 'child_process';
import yaml from 'yaml';
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

    let read = fs.createReadStream(source);
    read.on('error', function(err) {
      done(err);
    });
    let write = fs.createWriteStream(target);
    write.on('error', function(err) {
      done(err);
    });
    write.on('close', function(ex) {
      done();
    });
    read.pipe(write);
  });
}

const readYamlFile = (path: string): Promise<any> => {
  return new Promise(function(resolve, reject) {
    fs.readFile(path)
      .then((data) => resolve(yaml.parse(data.toString())))
      .catch((e) => reject(e))
  });
}

const getPhysicalCoreCount = (): Promise<any> => {
  return new Promise((resolve, reject) => {
    exc('WMIC CPU Get NumberOfCores').then((stdout) => {
      const match = stdout.match(/\d+/g);

      if (match) return resolve(parseInt(match[0]));

      return reject(new Error('getPhysicalCoreCount: Unable to get the physical core count.'));
    }).catch((e) => reject(e));
  });
};

const getUserSID = (username: string): Promise<string> => {
  return exc('WMIC useraccount get name,sid').then((out: string) => {
    const lines = out.split(EOL);

    for (let i = 0, len = lines.length; i < len; i++) {
      if (i === 0) continue;

      const [name, sid] = lines[i].split(/\s+/);

      if (name === username) return sid;
    }
  });
};

const getAffinityForCoreRanges = (
  cores: Array<number[]>,
  useHT: boolean = true,
  coreCount: number
): [number, string] => {
  let n: number = 0;
  let flatCores: number[] = [];
  let graph: any = Array(useHT ? coreCount / 2 : coreCount).fill('--');

  // Turn the 2D array of core range pairs into a flat array of actual cores
  for (let i = 0; i < cores.length; i++) {
    let [start, end] = cores[i];

    if (!end) {
      flatCores.push(start);
      continue;
    }

    while (start <= end) {
      flatCores.push(start);
      start++;
    }
  }

  for (let i = 0, len = flatCores.length; i < len; i++) {
    let coreNumber = flatCores[i];
    let n = coreNumber.toString();

    if (n.length === 1) n = ` ${n}`;

    graph[coreNumber] = n;
  }

  graph = `[${graph.join('|')}]`;

  // If we are concerned about hyper-threading, also select the logical cores.
  // This is generally preferred because IPC overhead gets worse when moving between physical cores.
  if (useHT) {
    let cores: number[] = flatCores.slice();
    for (let i = 0; i < cores.length; i++) {
      let core = cores[i] + (coreCount / 2);

      if (core > coreCount - 1 || cores.indexOf(core) > -1) break;

      flatCores.push(core);
    }
  }

  // Do some bit conversion to get the final mask windows expects
  for (let i = 0; i < flatCores.length; i++) {
    let mask = (1 << flatCores[i]);
    if (!n) n = mask;
    else n ^= mask;
  }

  return [n, graph];
};

const getEnumKeyFromValue = <T>(Enum: T, enumValue: unknown): keyof T | string => {
  let statusCode = 'Unknown';

  for (let key in Enum) {
    let value = Enum[key] as unknown as number | string;

    if (enumValue === value) {
      statusCode = key;
      break;
    }
  }

  return statusCode;
}

export {
  exc,
  getPhysicalCoreCount,
  getUserSID,
  copyFile,
  readYamlFile,
  getAffinityForCoreRanges,
  getEnumKeyFromValue,
};