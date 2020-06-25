import fs from 'fs-extra';
import {
  restartHidden,
  getPhysicalCoreCount,
  copyFile,
  getAffinityForCoreRanges,
  readYamlFile,
} from './utils';

//@ts-ignore
process.on('uncaughtException', async (err, origin) => {
  if (err.message.includes('Could not locate the bindings file')) {
    await restartHidden();
    return;
  }

  throw err;
});

import {EOL} from 'os';
import {SnapshotOptions, ProcessSnapshot} from 'process-list';
import {snapshot} from 'process-list';
import {
  isDevelopment,
  appDir,
  logDir,
  appConfigYamlPath,
  appConfigTaskXMLPath,
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
  adjustPrivilege,
  NT,
} from './nt';

import {installTaskSchedulerTemplate} from './configuration';
import {find} from '@jaszhix/utils';
import {mergeObjects} from './lang';
import log from './log';

let appConfigPath = appConfigYamlPath;
let physicalCoreCount: number;
let useHT: boolean = false;
let fullAffinity: number = null;
let selfAffinity: number = null;
let failedPids: number[] = [];
let tempSuspendedPids: number[] = [];
let fullscreenOptimizedPid = 0;
let fullscreenOriginalState = null;
let timeout: NodeJS.Timeout = null;
let appConfig: AppConfiguration = null;
let profileNames = [];
let processesConfigured = [];
let snapshotArgs: (keyof SnapshotOptions)[] = ['pid', 'name'];
let mtime: number = 0;
let now: number = 0;
let lastLogTime: number = 0;
let enforcePolicy: (processList: ProcessSnapshot[]) => void;
let loadConfiguration: (configPath?: string) => Promise<any>;

let canDebug = false;

const validateAndParseProfile = (appConfig: AppConfiguration, profile: ProcessConfiguration, index: number, isRootProfile = true) => {
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
    } else if (!cmd && (!profile.type || profile.type === 'standard')) {
      throw new Error(`[${name}] Misconfiguration found - missing required property 'processes'.`);
    } else {
      profile.processes = [];
    }

    if (profile.if) {
      if (!Array.isArray(profile.if)) {
        throw new Error(`[${profile.name}] 'if' block misconfiguration: 'if' should be an array of conditional objects.`);
      }

      for (let i = 0, len = profile.if.length; i < len; i++) {
        let n = i + 1;
        let item = profile.if[i];

        const thenValueIsString = typeof item.then === 'string';
        const thenValueIsKeyedObject = typeof item.then === 'object' && !Array.isArray(item.then);

        if (!item.condition) {
          throw new Error(`[${profile.name}] 'if' block misconfiguration (${n}): required 'condition' property is not defined.`)
        }

        if (ifConditionOptions.indexOf(item.condition) === -1) {
          throw new Error(`[${profile.name}] 'if' block misconfiguration (${n}): 'condition' value is invalid. Possible options are: ${ifConditionOptions.join(', ')}`);
        }

        if (!item.then) {
          throw new Error(`[${profile.name}] 'if' block misconfiguration (${n}): required 'then' property is not defined.`)
        }

        if (!thenValueIsString && !thenValueIsKeyedObject) {
          throw new Error(`[${profile.name}] 'if' block misconfiguration (${n}): the 'then' value is not a string or keyed object.`);
        }

        if (thenValueIsString && item.then !== 'disable') {
          throw new Error(`[${profile.name}] 'if' block misconfiguration (${n}): 'then' is a string, but the value is not 'disable'.`)
        }

        if (item.forProcesses) {
          if (!Array.isArray(item.forProcesses)) {
            throw new Error(`[${profile.name}] 'if' block misconfiguration (${n}): 'forProcesses' must be an array if defined.`);
          }

          for (let i = 0, len = item.forProcesses.length; i < len; i++) {
            if (typeof item.forProcesses[i] !== 'string') {
              throw new Error(`[${profile.name}] 'if' block misconfiguration (${n}): 'forProcesses' must be an array of strings.`);
            }

            item.forProcesses[i] = item.forProcesses[i].toLowerCase().replace(/\.exe$/, '');
          }
        }

        if (item.condition === 'running' && !item.forProcesses) {
          throw new Error(`[${profile.name}] 'if' block misconfiguration (${n}): 'condition' value is 'running', but 'forProcesses' is not an array.`);
        }

        if (thenValueIsKeyedObject) {
          let keys = Object.keys(profile).concat(Object.keys(item.then));

          validateAndParseProfile(appConfig, item.then, index, false);

          if (keys.indexOf('terminationDelay') === -1 && keys.indexOf('suspensionDelay') === -1) {
            for (let i = 0, len = keys.length; i < len; i++) {
              let key = keys[i];

              if (profile[key] == null) {
                throw new Error(`[${profile.name}] 'if' block misconfiguration (${n}): 'then' child cannot have keys the parent does not have.`);
              }
            }
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
    const [translatedAffinity, graph] = getAffinityForCoreRanges(affinity.ranges, useHT, coreCount);
    Object.assign(profile, {
      affinityName: affinity.name,
      affinity: translatedAffinity,
      graph
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
  const {profiles, ignoreProcesses, affinities, winControlAffinity} = appConfig;
  const endResults = [];
  let results = [];
  let fallbackProfile: ProcessConfiguration = null;
  let fullscreenProfile: ProcessConfiguration = null;

  if (winControlAffinity) {
    const refAffinity = find(affinities, (obj) => obj.name === winControlAffinity)

    if (!refAffinity) {
      throw new Error(`winControlAffinity does not reference a defined affinity preset name.`);
    }

    [selfAffinity, /* graph */] = getAffinityForCoreRanges(refAffinity.ranges, useHT, coreCount);

    // Set wincontrol's affinity
    setProcessorAffinity(process.pid, selfAffinity);
  }

  for (let i = 0, len = ignoreProcesses.length; i < len; i++) {
    ignoreProcesses[i] = ignoreProcesses[i].toLowerCase();
  }

  for (let i = 0, len = profiles.length; i < len; i++) {
    const profile: ProcessConfiguration = validateAndParseProfile(appConfig, profiles[i], i, true);
    let shouldContinue = false;

    switch (profile.type) {
      case 'standard':
        break;

      case 'fallback': {
        if (fallbackProfile) {
          throw new Error(`[${profile.name}] Multiple fallback profiles found. Only one profile can be set as fallback in a configuration.`);
        }

        fallbackProfile = profile;
        shouldContinue = true;

        break;
      }

      case 'fullscreen': {
        if (fullscreenProfile) {
          throw new Error(`[${profile.name}] Multiple fullscreen profiles found. Only one profile can be designated for fullscreen optimization in a configuration.`);
        }

        fullscreenProfile = profile;
        fullAffinity = <number>profile.affinity;
        shouldContinue = true;

        break;
      }

      default:
        if (profile.type != null) {
          throw new Error(`[${profile.name}] The profile type must be one of the following values: 'standard', 'fallback', or 'fullscreen'.`);
        }
    }

    if (shouldContinue) continue;

    // Move profiles containing the if property to the end of the results array.
    // The fallback profile should be the last item if found.
    if (profile.if) {
      endResults.push(profile);
    } else {
      results.push(profile);
    }
  }

  results = results.concat(endResults);

  if (fallbackProfile) {
    results = results.concat([fallbackProfile]);
  }

  if (fullscreenProfile) {
    results = results.concat([fullscreenProfile]);
  }

  appConfig.profiles = results;
}

const attemptProcessModification = (func: Function, name: string, cmdline: string, id: number, value: number): boolean => {
  if (!func(id, value)) {
    failedPids.push(id);
    return false;
  }

  return true;
}

const resetGlobals = () => {
  if (timeout) clearTimeout(timeout);

  timeout = null;
  appConfig = null;
  now = lastLogTime = 0;
  snapshotArgs = ['pid', 'name'];
  profileNames = [];
  processesConfigured = [];
};

const runRoutine = (checkConfigChange = true): void => {
  now = Date.now();

  fs.stat(appConfigPath).then((info) => {
    // Compare the app config's cached mtime with the current mtime, and reload everything if a change has occurred.
    if (checkConfigChange && appConfig.detectConfigChange && mtime && info.mtimeMs !== mtime) {
      resetGlobals();

      log.open();
      log.important('Configuration changed, reloading...');
      log.close();

      loadConfiguration();
      return Promise.resolve();
    }

    mtime = info.mtimeMs;

    return snapshot(...snapshotArgs);
  })
    .then(enforcePolicy)
    .catch((err) => {
      log.error(err);
      log.close();
    });
}

enforcePolicy = (processList: ProcessSnapshot[]): void => {
  if (!processList) return;

  if (timeout) clearTimeout(timeout);

  const {profiles, interval} = appConfig;
  const activeWindow = getActiveWindow();
  let {logging, loggingInterval, detailedLogging, ignoreProcesses} = appConfig;
  let isValidActiveFullscreenApp = false;
  let activeProcess;
  let logItems: LogItem[] = [];
  let refLogItem: LogItem;
  let logOutput: string = '';

  failedPids = [];

  if (loggingInterval) {
    log.enabled = appConfig.logging = logging = (now - lastLogTime > loggingInterval);
  }

  if (logging) {
    log.open();
    lastLogTime = now;
  }

  for (let i = 0, len = processList.length; i < len; i++) {
    const ps = processList[i];
    ps.name = ps.name.toLowerCase().replace(/\.exe$/, '');

    if (activeWindow.pid === ps.pid) {
      activeProcess = ps;
    }
  }

  if (activeWindow.isFullscreen) {
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

    // Check the ignore list
    if (ignoreProcesses.indexOf(psName) > -1) continue;

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
    let systemAffinity: number;

    if (pid === process.pid || !pid) continue;

    for (let i = 0, len = profiles.length; i < len; i++) {
      let profile = profiles[i];
      let {name, processes, cmd} = profile;
      let processMatched = processes.indexOf(psName) > -1;
      let cmdAffected: string;

      // Logging variables
      let isReplacedBy: string;
      let isDisabled = false;
      let conditionReason: string;

      if (!processMatched && cmd) {
        for (let i = 0, len = cmd.length; i < len; i++) {
          if (cmdline.indexOf(cmd[i]) > -1) {
            processMatched = true;
            if (logging) cmdAffected = cmd[i];
            break;
          }
        }
      }

      if (!processMatched && ((!usePerformancePriorities && profile.type === 'fallback') || profile.type === 'fullscreen')) processMatched = true;

      if (processMatched || usePerformancePriorities || isFullscreenOptimized) {
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
        if (profile.type === 'fullscreen') {
          switch (true) {
            case (usePerformancePriorities && !fullscreenOptimizedPid):
              [/* processAffinity */, systemAffinity] = getProcessorAffinity(pid);

              fullscreenOriginalState = {
                cpuPriority: getPriorityClass(pid),
                affinity: systemAffinity,
              };

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

        if (profile.if) {
          let shouldContinue = false;

          for (let i = 0, len = profile.if.length; i < len; i++) {
            let item = profile.if[i]

            item.active = false;

            switch (item.condition) {
              case 'running':
                for (let i = 0, len = processList.length; i < len; i++) {
                  let {name} = processList[i];

                  if (item.forProcesses.indexOf(name) > -1) {
                    item.active = true;
                    if (logging) conditionReason = `${name} is running`;
                  }
                }
                break;
              case 'fullscreenOverrideActive':
                if (isValidActiveFullscreenApp) {
                  // if 'forProcesses' is defined, only consider the listed applications as valid fullscreen apps.
                  if (item.forProcesses && item.forProcesses.indexOf(activeProcess.name) === -1) {
                    break;
                  }

                  item.active = true;
                  if (logging) conditionReason = `Active process '${activeProcess.name}' is fullscreen`;
                }
                break;
              case 'active':
                if (activeProcess.name === psName
                  || (item.forProcesses && item.forProcesses.indexOf(activeProcess.name) > -1)) {
                  item.active = true;
                  if (logging) conditionReason = `Process '${psName}' is active`;
                }
                break;
            }
          }

          for (let i = 0, len = profile.if.length; i < len; i++) {
            let item = profile.if[i];

            if (item.active) {
              switch (true) {
                // disable (skip) rule enforcement
                case (item.then === 'disable'):
                  shouldContinue = isDisabled = true;
                  break;
                // replace rule
                case (typeof item.then === 'object'):
                  isReplacedBy = item.then.name ? item.then.name : 'override';

                  profile = mergeObjects(profile, item.then);

                  if (profile.terminationDelay && !item.then.terminationDelay) {
                    profile.terminationDelay = null;
                  }

                  if (profile.suspensionDelay && !item.then.suspensionDelay) {
                    profile.suspensionDelay = null;
                  }

                  if (profile.suspensionDelay && tempSuspendedPids.indexOf(pid) === -1) {
                    tempSuspendedPids.push(pid);
                  }

                  break;
              }

            } else if (item.then) {
              // If this is a trackable process and suspensionDelay is set conditionally, attempt to resume.
              let tempSuspendedIndex = tempSuspendedPids.indexOf(pid);
              if (tempSuspendedIndex > -1) {
                resumeDelay = 1;
                tempSuspendedPids.splice(tempSuspendedIndex, 1);
              }
            }
          }

          if (shouldContinue) continue;
        }

        // Stop here if the process doesn't match - the fullscreen priority logic above is
        // intended to work for all processes.
        if (!fullscreenPriorityBoostAffected && !processMatched) continue;

        suspensionDelay = profile.suspensionDelay;
        resumeDelay = profile.resumeDelay;

        terminationDelay = profile.terminationDelay;
        affinity = <number>profile.affinity;
        cpuPriority = profile.cpuPriority;
        pagePriority = profile.pagePriority;
        ioPriority = profile.ioPriority;

        if (logging) {
          refLogItem = find(logItems, (item) => item.name === name);

          if (!refLogItem) {
            refLogItem = {
              name,
              isDisabled,
              isReplacedBy,
              conditionReason,
              affected: [{
                psName,
                cmdAffected,
                pids: [pid]
              }],
              failed: []
            };

            logItems.push(refLogItem);
          } else {
            const psObject = find(refLogItem.affected, (proc) => proc.psName === psName);

            if (!psObject) {
              refLogItem.affected.push({
                psName,
                pids: [pid]
              });
            } else {
              psObject.pids.push(pid);
            }
          }

          if (suspensionDelay) refLogItem.suspensionDelay = suspensionDelay;
          if (resumeDelay) refLogItem.resumeDelay = resumeDelay;
          if (terminationDelay) refLogItem.terminationDelay = terminationDelay;
          if (cpuPriority) refLogItem.cpuPriority = cpuPriorityMap[cpuPriority.toString()];
          if (pagePriority) refLogItem.pagePriority = pagePriorityMap[pagePriority.toString()];
          if (ioPriority) refLogItem.ioPriority = ioPriorityMap[ioPriority.toString()];

          if (affinity) {
            refLogItem.affinityName = profile.affinityName;
            refLogItem.graph = profile.graph;
          }
        }

        break;
      }
    }

    if (terminationDelay != null) {
      setTimeout(() => terminateProcess(pid), terminationDelay);
      continue;
    }

    if (cpuPriority != null && !attemptProcessModification(setPriorityClass, psName, cmdline, pid, cpuPriority)) {
      continue;
    }

    if (pagePriority != null && !attemptProcessModification(setPagePriority, psName, cmdline, pid, pagePriority)) {
      continue;
    }

    if (ioPriority != null && !attemptProcessModification(setIOPriority, psName, cmdline, pid, ioPriority)) {
      continue;
    }

    if (affinity != null && !attemptProcessModification(setProcessorAffinity, psName, cmdline, pid, affinity)) {
      continue;
    }

    if (suspensionDelay != null) {
      setTimeout(() => suspendProcess(pid), suspensionDelay);
      continue;
    }

    if (resumeDelay != null) {
      setTimeout(() => resumeProcess(pid), resumeDelay);
      continue;
    }
  }

  if (logging) {
    // Build the logging sequence
    for (let i = 0, len = logItems.length; i < len; i++) {
      let logItem = logItems[i];
      let {affected, graph, isDisabled, isReplacedBy, conditionReason} = logItem;
      let keys = Object.keys(logItem);
      let failed = [];

      logOutput +=
        `${EOL}${isDisabled ? '[disabled] ' : isReplacedBy ? `[${isReplacedBy}] ` : ''}${logItem.name} -> `;

      keys.splice(keys.indexOf('name'), 1);
      keys.splice(keys.indexOf('graph'), 1);
      keys.splice(keys.indexOf('affected'), 1);
      keys.splice(keys.indexOf('failed'), 1);
      keys.splice(keys.indexOf('isDisabled'), 1);
      keys.splice(keys.indexOf('isReplacedBy'), 1);
      keys.splice(keys.indexOf('conditionReason'), 1);

      for (let z = 0, len = keys.length; z < len; z++) {
        let key = keys[z];

        logOutput += `${key}: ${logItem[key]}${z === keys.length - 1 ? '' : ', '}`;
      }

      if (graph) {
        logOutput += `${EOL}${graph}`;
      }

      if (conditionReason) logOutput += `${EOL}${isDisabled ? 'Disabled' : 'Override'} reason: ${conditionReason}${EOL}`;

      if (affected.length) {
        logOutput += `${EOL}Affected:${EOL}`;

        for (let i = 0, len = affected.length; i < len; i++) {
          let {psName, cmdAffected, pids} = affected[i];
          let hasFailingProcess = false;
          let sPids = [];
          let fPids = [];

          for (let i = 0, len = pids.length; i < len; i++) {
            if (failedPids.indexOf(pids[i]) === -1) {
              sPids.push(pids[i]);
            } else if (!hasFailingProcess) {
              fPids.push(pids[i]);
              hasFailingProcess = true;
            }
          }

          if (sPids.length) {
            logOutput += `- ${psName}${pids && pids.length ? ` (${sPids.join(', ')})` : ''}${EOL}`;

            if (cmdAffected) {
              logOutput += `  Triggered by command line wildcard rule: '${cmdAffected}'${EOL}`;
            }
          }

          if (hasFailingProcess) {
            affected[i].pids = fPids;
            failed.push(affected[i]);
          }
        }
      }

      if (failed.length) {
        logOutput += `${EOL}Failed:${EOL}`;

        for (let i = 0, len = failed.length; i < len; i++) {
          let {psName, pids} = failed[i];

          logOutput += `- ${psName}${pids && pids.length ? ` (${pids.join(', ')})` : ''}${EOL}`;
        }
      }
    }

    log.info(logOutput);
    log.info(`Finished process enforcement in ${Date.now() - now}ms`);
    log.info('Fullscreen PID:', fullscreenOptimizedPid);
    log.info('=========================================================');
    log.close();
  }

  timeout = setTimeout(runRoutine, interval);
};

const getConfigInfo = () => {
  const {profiles} = appConfig;
  let fullscreenProfilePresent = false, fallbackProfilePresent = false;

  for (let i = 0, len = appConfig.profiles.length; i < len; i++) {
    const profile = profiles[i];

    if (profile.type === 'fallback') fallbackProfilePresent = true;
    if (profile.type === 'fullscreen') fullscreenProfilePresent = true;
  }

  log.important('====================== Config info ======================');
  log.important(`Configuration file: ${appConfigPath}`);
  log.important(`Polling rate: ${appConfig.interval}ms`);
  log.important(`Logging rate: ${appConfig.loggingInterval || appConfig.interval}ms`);
  log.important(`Environment: ${isDevelopment ? 'development' : 'production'}`);
  log.important(`Hyperthreading: ${useHT ? '✓' : '✗'}`);
  log.important(`Debug Privileges: ${canDebug ? '✓' : '✗'}`);
  log.important(`Fallback profile present: ${fallbackProfilePresent ? '✓' : '✗'}`);
  log.important(`Fullscreen profile present: ${fullscreenProfilePresent ? '✓' : '✗'}`);
  log.important(`Physical core count: ${physicalCoreCount}`);
  log.important(`Enforcement interval: ${appConfig.interval}ms`);
  log.important(`CPU affinity presets: ${appConfig.affinities.length}`);
  log.important(`Process profiles: ${appConfig.profiles.length}`);
  log.important(`Processes configured: ${processesConfigured.length}`);
  log.important('=========================================================');
  log.close();
}

const setup = () => {
  // Lower the priority of wincontrol to idle
  setPriorityClass(process.pid, cpuPriorityMap.idle);

  // Needed for setting ioPriority to high and modifying elevated processes
  canDebug = adjustPrivilege(NT.SecurityEntity.SeDebugPrivilege)
    && adjustPrivilege(NT.SecurityEntity.SeIncreaseBasePriorityPrivilege);

  getConfigInfo();

  runRoutine(false);

  console.log('Initialized');
};

loadConfiguration = (configPath?: string): Promise<any> => {
  if (configPath) appConfigPath = configPath;

  return getPhysicalCoreCount()
    .then((count) => {
      useHT = count !== coreCount;
      physicalCoreCount = count;
      [fullAffinity, ] = getAffinityForCoreRanges([[0, physicalCoreCount - 1]], useHT, coreCount);
      return fs.ensureDir(appDir);
    })
    .then(() => fs.ensureDir(logDir))
    .then(() => fs.exists(appConfigPath))
    .then((exists) => {
      if (!exists) return copyFile('./config.yaml', appConfigPath);
      return Promise.resolve();
    })
    .then(() => fs.exists(appConfigTaskXMLPath))
    .then((exists) => {
      if (!exists) return installTaskSchedulerTemplate(appConfigTaskXMLPath);
      return Promise.resolve();
    })
    .then(() => readYamlFile(appConfigPath))
    .then((config: AppConfiguration) => {
      let logLevelInvalid = false;

      if (!config) {
        config = {
          interval: 60000,
          logging: true,
          detailedLogging: false,
          consoleLogging: false,
          logLevel: 'info',
          detectConfigChange: true,
          ignoreProcesses: [],
          profiles: [],
          affinities: [],
          winControlAffinity: '',
        };
      }

      log.enabled = config.logging;
      log.enableConsoleLog = config.consoleLogging;

      if (isDevelopment || process.env.TEST_ENV) {
        log.enabled = log.enableConsoleLog = config.logging = config.consoleLogging = true;
        config.logLevel = 'info';
      }

      if (log.enabled && config.logLevel) {
        let index = LogLevel.indexOf(config.logLevel.toUpperCase());
        if (index > -1) log.logLevel = index;
        else logLevelInvalid = true;
      }

      log.open();

      log.important(process.argv)

      if (logLevelInvalid) log.error(`Invalid configuration: ${config.logLevel} is not a valid log level.`)

      appConfig = config;

      parseProfilesConfig(appConfig);

      setup();
    })
    .catch((e) => {
      log.error(e);
      log.close();
    });
}

const init = async () => {
  if (!process.env.processRestarting) {
    await restartHidden();
  } else {
    delete process.env.processRestarting;
  }

  loadConfiguration();
}

if (!process.env.TEST_ENV) {
  init();
}

export {loadConfiguration, parseProfilesConfig, resetGlobals};
