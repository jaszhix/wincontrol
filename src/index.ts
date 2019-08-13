import fs from 'fs-extra';
import {snapshot} from 'process-list';
import {
  appDir,
  logDir,
  appConfigYamlPath,
  ifConditionOptions,
  falsePositiveFullscreenApps,
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
import {
  getPhysicalCoreCount,
  copyFile,
  getAffinityForCoreRanges,
  readYamlFile
} from './utils';
import {find} from './lang';
import log from './log';

let physicalCoreCount: number;
let useHT: boolean = false;
let fullAffinity: number = null;
let failedProcesses = [];
let fullscreenOptimizedPid = 0;
let fullscreenOriginalState = null;
let timeout: NodeJS.Timeout = null;
let appConfig: AppConfiguration = null;
let profileNames = [];
let processesConfigured = [];
let snapshotArgs = ['pid', 'name'];
let mtime: number = 0;
let now: number;
let enforcePolicy: (processList: any[]) => void;
let loadConfiguration: () => void;

const validateAndParseProfile = (profile, index, isRootProfile = true) => {
  const affinity = find(appConfig.affinities, (obj) => obj.name === profile.affinity);
  const {name, cpuPriority, pagePriority, ioPriority, cmd} = profile;

  if (cmd && snapshotArgs.length === 2) snapshotArgs.push('cmdline');

  if (isRootProfile) {
    if (!name) {
      throw new Error(`[Profile #${index + 1}] Misconfiguration found - missing required property 'name'.`);
    }

    if (profileNames.indexOf(name) > -1) {
      throw new Error(`[${name}] Misconfiguration found - the 'name' property must be a unique identifier.`);
    }

    profileNames.push(name);

    // Strip process names of file extension notation as the Get-Process output doesn't have it.
    if (Array.isArray(profile.processes)) {
      for (let i = 0, len = profile.processes.length; i < len; i++) {
        let processName = profile.processes[i].toLowerCase().replace(/\.exe$/, '');

        profile.processes[i] = processName;

        if (processesConfigured.indexOf(processName) > -1) {
          throw new Error(
            `[${name}] Misconfiguration found - the process '${processName}' is either duplicated in a profile or handled in multiple profiles. `
            + 'A process can only be handled by one profile.'
          );
        }

        processesConfigured.push(processName);
      }
    } else if (!cmd) {
      throw new Error(`[${name}] Misconfiguration found - missing required property 'processes'.`);
    } else {
      profile.processes = [];
    }

    if (profile.if) {
      const thenValueIsString = typeof profile.if.then === 'string';
      const thenValueIsKeyedObject = typeof profile.if.then === 'object' && !Array.isArray(profile.if.then);

      if (!profile.if.condition) {
        throw new Error(`[${profile.name}] 'if' block misconfiguration: required 'condition' property is not defined.`)
      }

      if (ifConditionOptions.indexOf(profile.if.condition) === -1) {
        throw new Error(`[${profile.name}] 'if' block misconfiguration: 'condition' value is invalid. Possible options are: ${ifConditionOptions.join(', ')}`);
      }

      if (!profile.if.then) {
        throw new Error(`[${profile.name}] 'if' block misconfiguration: required 'then' property is not defined.`)
      }

      if (!thenValueIsString && !thenValueIsKeyedObject) {
        throw new Error(`[${profile.name}] 'if' block misconfiguration: the 'then' value is not a string or keyed object.`);
      }

      if (thenValueIsString && profile.if.then !== 'disable') {
        throw new Error(`[${profile.name}] 'if' block misconfiguration: 'then' is a string, but the value is not 'disable'.`)
      }

      if (profile.if.forProcesses) {
        if (!Array.isArray(profile.if.forProcesses)) {
          throw new Error(`[${profile.name}] 'if' block misconfiguration: 'forProcesses' must be an array if defined.`);
        }

        for (let i = 0, len = profile.if.forProcesses.length; i < len; i++) {
          if (typeof profile.if.forProcesses[i] !== 'string') {
            throw new Error(`[${profile.name}] 'if' block misconfiguration: 'forProcesses' must be an array of strings.`);
          }

          profile.if.forProcesses[i] = profile.if.forProcesses[i].toLowerCase().replace(/\.exe$/, '');
        }
      }

      if (profile.if.condition === 'running' && !profile.if.forProcesses) {
        throw new Error(`[${profile.name}] 'if' block misconfiguration: 'condition' value is 'running', but 'forProcesses' is not an array.`);
      }

      if (thenValueIsKeyedObject) {
        let keys = Object.keys(profile.if.then);

        validateAndParseProfile(profile.if.then, index, false);

        for (let i = 0, len = keys.length; i < len; i++) {
          let key = keys[i];

          if (profile[key] == null) {
            throw new Error(`[${profile.name}] 'if' block misconfiguration: 'then' child cannot have keys the parent does not have.`);
          }
        }
      }
    }

  } else {
    if (profile.processes) {
      throw new Error(`[${name}] Misconfiguration found - child profiles cannot have a 'processes' value defined.`);
    }

    if (profile.if) {
      throw new Error(`[${name}] Misconfiguration found - child profiles cannot have an 'if' value defined.`);
    }
  }

  if (affinity) {
    Object.assign(profile, {
      affinity: getAffinityForCoreRanges(affinity.ranges, useHT, coreCount),
      affinityName: affinity.name,
    });
  }

  Object.assign(profile, {
    cpuPriority: cpuPriority != null ? cpuPriorityMap[cpuPriority] : undefined,
    pagePriority: pagePriority != null ? pagePriorityMap[pagePriority] : undefined,
    ioPriority: ioPriority != null ? ioPriorityMap[ioPriority] : undefined,
  });

  return profile;
}

const parseProfilesConfig = (appConfig: AppConfiguration): void => {
  const {profiles} = appConfig;
  const results = [];
  const endResults = [];

  for (let i = 0, len = profiles.length; i < len; i++) {
    const profile = validateAndParseProfile(profiles[i], i, true);

    // Move profiles containing the if property to the end of the results array.
    if (profile.if) {
      endResults.push(profile);
    } else {
      results.push(profile);
    }
  }

  appConfig.profiles = results.concat(endResults);
}

const attemptProcessModification = (func: Function, id: number, value: number): boolean => {
  if (!func(id, value)) {
    failedProcesses.push(id);
    return false;
  }

  return true;
}

const runRoutine = (checkConfigChange = true): void => {
  now = Date.now();

  fs.stat(appConfigYamlPath).then((info) => {
    // Compare the app config's cached mtime with the current mtime, and reload everything if a change has occurred.
    if (checkConfigChange && appConfig.detectConfigChange && mtime && info.mtimeMs !== mtime) {
      if (timeout) clearTimeout(timeout);

      timeout = null;
      appConfig = null;
      snapshotArgs = ['pid', 'name'];
      profileNames = [];
      processesConfigured = [];

      log.open();
      log.info('Configuration changed, reloading...');
      log.close();

      loadConfiguration();
      return Promise.resolve();
    }

    mtime = info.mtimeMs;

    return snapshot(...snapshotArgs);
  })
    .then(enforcePolicy)
    .catch((err) => log.error(err));
}

enforcePolicy = (processList): void => {
  if (!processList) return;

  for (let i = 0, len = processList.length; i < len; i++) {
    const ps = processList[i];
    ps.name = ps.name.toLowerCase().replace(/\.exe$/, '');
  }

  if (timeout) clearTimeout(timeout);

  log.open();

  const {profiles, interval} = appConfig;
  const activeWindow = getActiveWindow();
  const {detailedLogging} = appConfig;
  let isValidActiveFullscreenApp = false;
  let previousProcessName: string;
  let previousProfile: ProcessConfiguration;
  let activeProcess;

  if (activeWindow.isFullscreen) {
    activeProcess = find(processList, (item) => activeWindow.pid === item.pid);
    isValidActiveFullscreenApp = falsePositiveFullscreenApps.indexOf(activeProcess.name) === -1;
  }

  // Clear the fullscreen optimized pid if the process exited.
  if (fullscreenOptimizedPid && !find(processList, (item) => item.pid === fullscreenOptimizedPid)) {
    fullscreenOptimizedPid = 0;
    fullscreenOriginalState = null;
  }

  if (detailedLogging && activeProcess) log.info(`Active window: ${activeProcess.name}`);

  for (let i = 0, len = processList.length; i < len; i++) {
    let ps = processList[i];
    let {pid, name, cmdline} = ps;
    let psName = name;

    // If we've ever failed, there's a good chance we don't have correct permissions to modify the process.
    // This mostly happens with security processes, or core system processes (e.g. "System", "Memory Compression").
    // Avoid log spam and stop attempting to change its attributes after the first failure, unless the
    // fullscreen priority is applied.
    if (failedProcesses.indexOf(pid) > -1 && pid !== fullscreenOptimizedPid) continue;

    let isActive = pid === activeWindow.pid;
    let usePerformancePriorities = isActive && isValidActiveFullscreenApp;
    let isFullscreenOptimized = fullscreenOptimizedPid && pid === fullscreenOptimizedPid;
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

    if (pid === process.pid) continue;

    for (let i = 0, len = profiles.length; i < len; i++) {
      let profile = profiles[i];
      let {name, processes, cmd} = profile;

      let processMatched = processes.indexOf(psName) > -1;

      if (!processMatched && cmd) {
        for (let i = 0, len = cmd.length; i < len; i++) {
          if (cmdline.indexOf(cmd[i]) > -1) {
            processMatched = true;
            break;
          }
        }
      }

      if (processMatched || usePerformancePriorities || isFullscreenOptimized) {
        let attributesString = `[${name}] ${psName} (${pid}): `;
        let logAttributes = [];
        let shouldLog = detailedLogging || previousProcessName !== psName || previousProfile !== profile;

        if (profile.if) {
          let useCondition = false;

          switch (profile.if.condition) {
            case 'running':
              if (find(processList, (item) => profile.if.forProcesses.indexOf(item.name) > -1)) {
                useCondition = true;
              }
              break;
            case 'fullscreenOverrideActive':
              if (appConfig.fullscreenPriority && isValidActiveFullscreenApp) {
                // if 'forProcesses' is defined, only consider the listed applications as valid fullscreen apps.
                if (profile.if.forProcesses && profile.if.forProcesses.indexOf(activeProcess.name) === -1) {
                  break;
                }

                useCondition = true;
              }
              break;
          }

          if (useCondition) {
            let shouldContinue = false;

            if (detailedLogging) {
              log.info(
                `${attributesString}if -> ${profile.if.condition} -> then -> `
                + `${typeof profile.if.then !== 'string' ? 'replace' : profile.if.then} -> true`
              );
            }

            switch (true) {
              // disable (skip) rule enforcement
              case (profile.if.then === 'disable'):
                shouldContinue = true;
                break;
              // replace rule
              case (typeof profile.if.then === 'object'):
                attributesString = `[${name += ` -> ${profile.if.then.name ? profile.if.then.name : 'override'}`}] ${psName} (${pid})`;
                profile = Object.assign({}, profile, profile.if.then);
                break;
            }

            if (shouldContinue) continue;
          }
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
              [processAffinity, systemAffinity] = getProcessorAffinity(pid);

              fullscreenOriginalState = {
                cpuPriority: getPriorityClass(pid),
                affinity: systemAffinity,
              };

              profile = Object.assign({}, profile, {
                affinity: fullAffinity,
                cpuPriority: cpuPriorityMap.high,
                pagePriority: pagePriorityMap.normal,
                ioPriority: ioPriorityMap.normal,
              });

              log.info(`Priority boosting fullscreen window ${psName} (${pid})`);

              fullscreenOptimizedPid = pid;
              fullscreenPriorityBoostAffected = true;
              break;
            case (isFullscreenOptimized && !usePerformancePriorities):
              profile = Object.assign({}, profile, {
                affinity: fullscreenOriginalState.affinity,
                cpuPriority: fullscreenOriginalState.cpuPriority,
                pagePriority: pagePriorityMap.normal,
                ioPriority: ioPriorityMap.normal,
              });

              log.info(`Resetting priority boost for previously fullscreen window ${psName} (${pid})`);

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
      setTimeout(() => suspendProcess(pid), suspensionDelay);
      continue;
    }

    if (resumeDelay != null) {
      setTimeout(() => resumeProcess(pid), resumeDelay);
      continue;
    }

    if (terminationDelay != null) {
      setTimeout(() => terminateProcess(pid), terminationDelay);
      continue;
    }

    if (cpuPriority != null) {
      if (!attemptProcessModification(setPriorityClass, pid, cpuPriority)) continue;
    }

    if (pagePriority != null) {
      if (!attemptProcessModification(setPagePriority, pid, pagePriority)) continue;
    }

    if (ioPriority != null) {
      if (!attemptProcessModification(setIOPriority, pid, ioPriority)) continue;
    }

    if (affinity != null) {
      if (!attemptProcessModification(setProcessorAffinity, pid, affinity)) continue;
    }

    previousProcessName = psName;
  }

  log.info(`Finished process enforcement in ${Date.now() - now}ms`);
  log.close();

  timeout = setTimeout(runRoutine, interval);
};

const init = () => {
  // Lower the priority of wincontrol to idle
  setPriorityClass(process.pid, cpuPriorityMap.idle);

  log.info('====================== Config info ======================');
  log.info(`Configuration file: ${appConfigYamlPath}`);
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
      fullAffinity = getAffinityForCoreRanges([[0, physicalCoreCount - 1]], useHT, coreCount);
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
          detailedLogging: false,
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

      parseProfilesConfig(appConfig);

      init();
    })
    .catch((e) => {
      log.error(e);
      log.close();
    });
}

loadConfiguration();
