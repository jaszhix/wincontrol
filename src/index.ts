import fs from 'fs-extra';
import {exec, ChildProcess} from 'child_process';
import yaml from 'yaml';
import {
  psCommand,
  execOptions,
  appDir,
  logDir,
  appConfigYamlPath,
  coreCount,
  cpuPriorityMap,
  pagePriorityMap,
  ioPriorityMap,
  LogLevel
} from './constants';
import {
  getActiveWindow,
  //getWindows,
  getPriorityClass,
  getProcessorAffinity,
  setPriorityClass,
  setProcessorAffinity,
  setPagePriority,
  setIOPriority,
  terminateProcess,
  suspendProcess,
  resumeProcess,
} from './nt';
import {getPhysicalCoreCount, copyFile} from './utils';
import {each, find} from './lang';
import log from './log';

let physicalCoreCount: number;
let useHT: boolean = false;
let fullAffinity: number = null;
let childProcess: ChildProcess = null;
let failedProcesses = [];
let fullscreenOptimizedPid = 0;
let fullscreenOriginalState = null;
let timeout: NodeJS.Timeout = null;
let appConfig: AppConfiguration = null;
let processesConfigured = [];
let mtime: number = 0;
let enforcePolicy: () => void;
let loadConfiguration: () => void;

const getAffinityForCoreRanges = (cores: Array<number[]>): number => {
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
    const {cpuPriority, pagePriority, ioPriority} = profile;

    // Strip process names of file extension notation as the Get-Process output doesn't have it.
    each(profile.processes, (name, i) => {
      name = name.toLowerCase().replace(/\.exe$/, '');
      profile.processes[i] = name;

      if (processesConfigured.indexOf(name) === -1) {
        processesConfigured.push(name);
      }
    });
    each(profile.disableIfRunning, (name, i) => {
      profile.disableIfRunning[i] = name.toLowerCase().replace(/\.exe$/, '');
    });

    if (affinity) {
      Object.assign(profile, {
        affinity: getAffinityForCoreRanges(affinity.ranges),
        affinityName: affinity.name,
      });
    }

    Object.assign(profile, {
      cpuPriority: cpuPriority != null ? cpuPriorityMap[cpuPriority] : undefined,
      pagePriority: pagePriority != null ? pagePriorityMap[pagePriority] : undefined,
      ioPriority: ioPriority != null ? ioPriorityMap[ioPriority] : undefined,
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

const runRoutine = (checkConfigChange = true): void => {
  fs.stat(appConfigYamlPath).then((info) => {
    // Compare the app config's cached mtime with the current mtime, and reload everything if a change has occurred.
    if (checkConfigChange && appConfig.detectConfigChange && mtime && info.mtimeMs !== mtime) {
      if (timeout) clearTimeout(timeout);

      timeout = null;
      appConfig = null;
      processesConfigured = [];

      log.open();
      log.info('Configuration changed, reloading...');
      log.close();

      loadConfiguration();
    } else {
      enforcePolicy();
    }

    mtime = info.mtimeMs;
  });
}

enforcePolicy = (): void => {
  if (timeout) clearTimeout(timeout);

  log.open();

  childProcess = exec(psCommand, execOptions, (err, stdout, stderr) => {
    const now = Date.now();
    const {profiles, interval} = appConfig;
    const activeWindow = getActiveWindow();
    const processList: PowerShellProcess[] = JSON.parse(stdout.toString().replace(//g, '').trim());
    const {logPerProcessAndRule} = appConfig;
    let previousProcessName: string;
    let previousProfile: ProcessConfiguration;

    for (let i = 0, len = processList.length; i < len; i++) {
      let ps = processList[i];
      let {Id, Name} = ps;

      Name = Name.toLowerCase();

      // If we've ever failed, there's a good chance we don't have correct permissions to modify the process.
      // This mostly happens with security processes, or core system processes (e.g. "System", "Memory Compression").
      // Avoid log spam and stop attempting to change its attributes after the first failure, unless the
      // fullscreen priority is applied.
      if (failedProcesses.indexOf(Id) > -1 && Id !== fullscreenOptimizedPid) continue;

      let isActive = Id === activeWindow.pid;
      let usePerformancePriorities = isActive && activeWindow.isFullscreen && Name !== 'explorer';
      let isFullscreenOptimized = fullscreenOptimizedPid && Id === fullscreenOptimizedPid;
      let fullscreenPriorityBoostAffected = false;
      let affinity: number;
      let cpuPriority: number;
      let pagePriority: number;
      let ioPriority: number;
      let terminationDelay: number;
      let suspensionDelay: number;
      let resumeDelay: number;
      let processAffinity: number;
      let systemAffinity: number;

      if (Id === process.pid || Id === childProcess.pid) continue;

      for (let i = 0, len = profiles.length; i < len; i++) {
        let profile = profiles[i];
        let processMatched = profile.processes.indexOf(Name) > -1;

        if (processMatched || usePerformancePriorities || isFullscreenOptimized) {
          let {disableIfRunning} = profile;
          let attributesString = `[${profile.name}] ${Name} (${Id}): `;
          let logAttributes = [];
          let shouldLog = !logPerProcessAndRule || previousProcessName !== Name || previousProfile !== profile;

          // Only enforce this profile if the definitions in disableIfRunning are not running.
          if (disableIfRunning && find(processList, (item) => disableIfRunning.indexOf(item.Name.toLowerCase()) > -1)) {
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

          // Handle fullscreen priority increase. If the active window is taking up exactly
          // the dimensions of the primary monitor, then we will give it high priority.
          // TODO: This doesn't work with some games, so there is more needing to be done
          // as far as detecting the window/monitor rects.
          if (appConfig.fullscreenPriority) {
            switch (true) {
              case (usePerformancePriorities && !fullscreenOptimizedPid):
                [processAffinity, systemAffinity] = getProcessorAffinity(Id);

                fullscreenOriginalState = {
                  cpuPriority: getPriorityClass(Id),
                  affinity: systemAffinity,
                };

                profile = Object.assign({}, profile, {
                  affinity: fullAffinity,
                  cpuPriority: cpuPriorityMap.high,
                  pagePriority: pagePriorityMap.normal,
                  ioPriority: ioPriorityMap.normal,
                });

                log.info(`Priority boosting fullscreen window ${Name} (${Id})`);

                fullscreenOptimizedPid = Id;
                fullscreenPriorityBoostAffected = true;
                break;
              case (isFullscreenOptimized && !usePerformancePriorities):
                profile = Object.assign({}, profile, {
                  affinity: fullscreenOriginalState.affinity,
                  cpuPriority: fullscreenOriginalState.cpuPriority,
                  pagePriority: pagePriorityMap.normal,
                  ioPriority: ioPriorityMap.normal,
                });

                log.info(`Resetting priority boost for previously fullscreen window ${Name} (${Id})`);

                fullscreenOptimizedPid = 0;
                fullscreenPriorityBoostAffected = true;
                fullscreenOriginalState = null;
                break;
            }
          }

          // Stop here if the process doesn't match - the fullscreen priority logic above is
          // intended to work for all processes.
          if (!fullscreenPriorityBoostAffected && !processMatched) continue;

          if (suspensionDelay = profile.suspensionDelay) {
            logAttributes.push(`suspension delay: ${suspensionDelay}`);
          }

          if (resumeDelay = profile.resumeDelay) {
            logAttributes.push(`resume delay: ${resumeDelay}`);
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

          if (shouldLog) log.info(`${attributesString} ${logAttributes.join(', ')}`);
          previousProfile = profile;
          break;
        }
      }

      if (suspensionDelay != null) {
        setTimeout(() => suspendProcess(Id), suspensionDelay);
        continue;
      }

      if (resumeDelay != null) {
        setTimeout(() => resumeProcess(Id), resumeDelay);
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

      previousProcessName = Name;
    }

    log.info(`Finished process enforcement in ${Date.now() - now}ms`);
    log.close();

    timeout = setTimeout(runRoutine, interval);
  });
};

const init = () => {
  // Lower the priority of wincontrol to idle
  setPriorityClass(process.pid, cpuPriorityMap.idle);

  log.info('====================== Config info ======================');
  log.info(`Hyperthreading: ${useHT ? '✓' : '✗'}`);
  log.info(`Using high fullscreen window priority: ${appConfig.fullscreenPriority ? '✓' : '✗'}`);
  log.info(`Physical core count: ${physicalCoreCount}`);
  log.info(`Enforcement interval: ${appConfig.interval}ms`);
  log.info(`CPU affinity presets: ${appConfig.affinities.length}`);
  log.info(`Process profiles: ${appConfig.profiles.length}`);
  log.info(`Processes configured: ${processesConfigured.length}`);
  log.info('=========================================================');
  log.close();

  runRoutine(false);

  console.log('Initialized');
};

loadConfiguration = (): void => {
  getPhysicalCoreCount()
    .then((count) => {
      useHT = count !== coreCount;
      physicalCoreCount = count;
      fullAffinity = getAffinityForCoreRanges([[0, physicalCoreCount - 1]]);
      return fs.ensureDir(appDir);
    })
    .then(() => fs.ensureDir(logDir))
    .then(() => fs.exists(appConfigYamlPath))
    .then((exists) => {
      if (!exists) return copyFile('./config.yaml', appConfigYamlPath);
      return Promise.resolve();
    })
    .then(() => readYamlFile(appConfigYamlPath))
    .then((config: AppConfiguration) => {
      let logLevelInvalid = false;

      if (!config) {
        config = {
          interval: 120000,
          logging: true,
          logPerProcessAndRule: true,
          logLevel: 'info',
          detectConfigChange: true,
          fullscreenPriority: true,
          profiles: [],
          affinities: []
        };
      }

      log.enabled = config.logging;

      if (log.enabled && config.logLevel) {
        let index = LogLevel.indexOf(config.logLevel.toUpperCase());
        if (index > -1) log.logLevel = index;
        else logLevelInvalid = true;
      }

      log.open();

      if (logLevelInvalid) log.error(`Invalid configuration: ${config.logLevel} is not a valid log level.`)

      appConfig = config;

      parseProfilesConfig(config.profiles);

      init();
    })
    .catch((e) => {
      log.error(e);
      log.close();
    });
}

loadConfiguration();
