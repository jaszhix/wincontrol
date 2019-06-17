import os from 'os';
import fs from 'fs-extra';

import {exec, ChildProcess} from 'child_process';
import yaml from 'yaml';
import {
  getActiveWindow,
  //getWindows,
  //getPriorityClass,
  //getProcessorAffinity,
  setPriorityClass,
  setProcessorAffinity,
  setPagePriority,
  setIOPriority,
  terminateProcess,
  suspendProcess
} from './nt';
import {find} from './lang';
import log from './log';

const coreCount: number = os.cpus().length;
const homeDir: string = os.homedir();
const appDir: string = `${homeDir}\\AppData\\Roaming\\WinControl`;
const appConfigYamlPath: string = `${appDir}\\config.yaml`;
let childProcess: ChildProcess = null;

const options: any = {
  windowsHide: true,
  encoding: 'utf8',
  timeout: 0,
  maxBuffer: 4096*4096,
  // cwd: null,
  // env: null,
  stdio: ['ignore', 'pipe', 'ignore']
}

const command = `powershell "Get-Process | Select-Object -Property 'Name','Id','StartTime','Threads','number','TotalProcessorTime' | ConvertTo-Json -Compress"`;

const getAffinityForCoreRanges = (cores: Array<number[]>, useHT: boolean = true): number => {
  let n: number = 0;
  let flatCores: number[] = [];

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
  return n;
};



let timeout: NodeJS.Timeout = null;

const fullAffinity: number = getAffinityForCoreRanges([[0, 13]]);

enum cpuPriorityMap {
  idle = 64,
  belowNormal = 16384,
  normal = 32,
  aboveNormal = 32768,
  high = 128,
  realTime = 256,
  processModeBackgroundBegin = 1048576
};

enum pagePriorityMap {
  idle = 1,
  low = 2,
  medium = 3,
  belowNormal = 4,
  normal = 5
};

enum ioPriorityMap {
  idle = 0,
  low,
  normal,
  high
}

const failedProcesses = [];
let fullscreenOptimizedPid = 0;

let appConfig: AppConfiguration = null;

const readYamlFile = (path: string): Promise<any> => {
  return new Promise(function(resolve, reject) {
    fs.readFile(path)
      .then((data) => resolve(yaml.parse(data.toString())))
      .catch((e) => reject(e))
  });
}

const parseProfilesConfig = (profiles: ProcessConfiguration[]): ProcessConfiguration[] => {
  for (let i = 0, len = profiles.length; i < len; i++) {
    const profile = profiles[i];
    const affinity = find(appConfig.affinities, (obj) => obj.name === profile.affinity);

    if (!affinity) {
      log.info('Skipping affinity parsing for process profile:', profile.name);
      continue;
    }

    Object.assign(profile, {
      affinity: getAffinityForCoreRanges(affinity.ranges),
      affinityName: affinity.name,
      cpuPriority: cpuPriorityMap[profile.cpuPriority],
      pagePriority: pagePriorityMap[profile.pagePriority],
      ioPriority: ioPriorityMap[profile.ioPriority]
    });
  }

  return profiles;
}

const attemptProcessModification = (func: Function, id: number, value: number): boolean => {
  if (!func(id, value)) {
    failedProcesses.push(id);
    return false;
  }

  return true;
}

const enforceAffinityPolicy = (): void => {
  if (timeout) clearTimeout(timeout);

  log.open();

  childProcess = exec(command, options, (err, stdout, stderr) => {
    const now = Date.now();
    const {profiles, interval} = appConfig;
    const activeWindow = getActiveWindow();
    const processList: PowerShellProcess[] = JSON.parse(stdout.toString().replace(//g, '').trim());

    for (let i = 0, len = processList.length; i < len; i++) {
      let ps = processList[i];
      let {Id, Name} = ps;

      // If we've ever failed, there's a good chance we don't have correct permissions to modify the process.
      // This mostly happens with security processes, or core system processes (e.g. "System", "Memory Compression").
      // Avoid log spam and stop attempting to change its attributes after the first failure, unless the
      // fullscreen priority is applied.
      if (failedProcesses.indexOf(Id) > -1 && ps.Id !== fullscreenOptimizedPid) continue;

      let isActive = ps.Id === activeWindow.pid;
      let usePerformancePriorities = isActive && activeWindow.isFullscreen && ps.Name !== 'explorer';
      let isFullscreenOptimized = fullscreenOptimizedPid && ps.Id === fullscreenOptimizedPid;
      let affinity: number;
      let cpuPriority: number;
      let pagePriority: number;
      let ioPriority: number;
      let terminationDelay: number;
      let suspensionDelay: number;

      if (Id === process.pid || Id === childProcess.pid) continue;

      for (let i = 0, len = profiles.length; i < len; i++) {
        let profile = profiles[i];
        let processMatched = profile.processes.indexOf(ps.Name) > -1;

        if (processMatched || usePerformancePriorities || isFullscreenOptimized) {
          let {disableIfRunning} = profile;
          let attributesString = `[${profile.name}] ${Name} (${Id}): `;
          let logAttributes = [];

          // Only enforce this profile if the definitions in disableIfRunning are not running.
          if (disableIfRunning && find(processList, (item) => disableIfRunning.indexOf(item.Name) > -1)) {
            log.info(`Profile will not be enforced due to blacklisted process running: ${Name} (${Id})`);
            continue;
          }

          if (isActive) {
            if (profile.affinity && profile.affinity !== fullAffinity) {
              profile = Object.assign({}, profile, {
                affinity: fullAffinity,
              });
            }
          }

          if (usePerformancePriorities && !fullscreenOptimizedPid) {
            profile = Object.assign({}, profile, {
              affinity: fullAffinity,
              cpuPriority: cpuPriorityMap.high,
              pagePriority: pagePriorityMap.normal,
              ioPriority: ioPriorityMap.normal,
            });
            console.log('PRIORITY BOOSTING:', ps.Name);
            fullscreenOptimizedPid = ps.Id;
          } else if (isFullscreenOptimized && !usePerformancePriorities) {
            profile = Object.assign({}, profile, {
              affinity: fullAffinity,
              cpuPriority: cpuPriorityMap.normal,
              pagePriority: pagePriorityMap.normal,
              ioPriority: ioPriorityMap.normal,
            });
            fullscreenOptimizedPid = 0;
            console.log('RESETTING PRIORITY BOOST:', ps.Name);
          } else if (!processMatched) continue;

          if (suspensionDelay = profile.suspensionDelay) {
            logAttributes.push(`suspension delay: ${suspensionDelay}`);
          }

          if (terminationDelay = profile.terminationDelay) {
            logAttributes.push(`termination delay: ${terminationDelay}`);
          }

          if (affinity = profile.affinity) {
            logAttributes.push(`affinity: ${profile.affinityName}`);
          }

          if (cpuPriority = profile.cpuPriority) {
            logAttributes.push(`cpuPriority: ${cpuPriorityMap[cpuPriority.toString()]}`);
          }

          if (pagePriority = profile.pagePriority) {
            logAttributes.push(`pagePriority: ${pagePriorityMap[pagePriority.toString()]}`);
          }

          if (ioPriority = profile.ioPriority) {
            logAttributes.push(`ioPriority: ${ioPriorityMap[ioPriority.toString()]}`);
          }

          //if (ps.Id === activeWindow.pid) console.log(attributesString);
          log.info(`${attributesString} ${logAttributes.join(', ')}`);
          break;
        }
      }

      if (suspensionDelay != null) {
        setTimeout(() => suspendProcess(Id), suspensionDelay);
        continue;
      }

      if (terminationDelay != null) {
        setTimeout(() => terminateProcess(Id), terminationDelay);
        continue;
      }

      if (cpuPriority != null) {
        if (!attemptProcessModification(setPriorityClass, Id, cpuPriority)) continue;
      }

      if (pagePriority != null) {
        if (!attemptProcessModification(setPagePriority, Id, pagePriority)) continue;
      }

      if (ioPriority != null) {
        if (!attemptProcessModification(setIOPriority, Id, ioPriority)) continue;
      }

      if (affinity != null) {
        if (!attemptProcessModification(setProcessorAffinity, Id, affinity)) continue;
      }
    }
    log.info(`Finished process enforcement in ${Date.now() - now}ms`);

    log.close();

    timeout = setTimeout(enforceAffinityPolicy, interval);
  });
};

const init = () => {
  log.info('====================== New session ======================');
  log.info(`Enforcement interval: ${appConfig.interval}`);
  log.info(`CPU affinity presets: ${appConfig.affinities.length}`);
  log.info(`Process profiles: ${appConfig.profiles.length}`);
  log.info('=========================================================');

  setPriorityClass(process.pid, cpuPriorityMap.idle);

  log.close();

  enforceAffinityPolicy();

  console.log('Initialized')
};

fs.ensureDir(appDir)
  .then(fs.ensureFile(appConfigYamlPath))
  .then(() => {
    /* TODO: Setup defaults */
    return readYamlFile(appConfigYamlPath);
  })
  .then((config: AppConfiguration) => {
    if (!config) {
      config = {
        interval: 120000,
        enableLogging: true,
        profiles: [],
        affinities: []
      };
    }

    log.enabled = config.enableLogging;

    log.open();

    appConfig = config;

    parseProfilesConfig(config.profiles);

    init();
  })
  .catch((e) => {
    log.error(e);
    log.close();
  });
