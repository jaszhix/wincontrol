import fs from 'fs-extra';
import {EOL} from 'os';
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
} from './nt';
import {
  getPhysicalCoreCount,
  copyFile,
  getAffinityForCoreRanges,
  readYamlFile
} from './utils';
import {installTaskSchedulerTemplate} from './configuration';
import {find} from './lang';
import log from './log';

let physicalCoreCount: number;
let useHT: boolean = false;
let fullAffinity: number = null;
let failedPids = [];
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
    } else if (!cmd && !profile.default) {
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

        if (keys.indexOf('terminationDelay') === -1) {
          for (let i = 0, len = keys.length; i < len; i++) {
            let key = keys[i];

            if (profile[key] == null) {
              throw new Error(`[${profile.name}] 'if' block misconfiguration: 'then' child cannot have keys the parent does not have.`);
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
  const {profiles, ignoreProcesses} = appConfig;
  const results = [];
  const endResults = [];
  let defaultProfile: ProcessConfiguration = null;

  for (let i = 0, len = ignoreProcesses.length; i < len; i++) {
    ignoreProcesses[i] = ignoreProcesses[i].toLowerCase();
  }

  for (let i = 0, len = profiles.length; i < len; i++) {
    const profile = validateAndParseProfile(profiles[i], i, true);

    if (profile.default) {
      if (defaultProfile) {
        throw new Error(`[${profile.name}] Multiple default profiles found. Only one profile can be set as default in a configuration.`);
      }

      defaultProfile = profile;
      continue;
    }

    // Move profiles containing the if property to the end of the results array.
    // The default property should be the last item if found.
    if (profile.if) {
      endResults.push(profile);
    } else {
      results.push(profile);
    }
  }

  appConfig.profiles = results
    .concat(endResults)
    .concat([defaultProfile]);
}

const attemptProcessModification = (func: Function, name: string, cmdline: string, id: number, value: number): boolean => {
  if (!func(id, value)) {
    failedPids.push(id);
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

  const {profiles, interval} = appConfig;
  const activeWindow = getActiveWindow();
  const {logging, detailedLogging, ignoreProcesses} = appConfig;
  let isValidActiveFullscreenApp = false;
  let activeProcess;
  let logItems: any[] = [];
  let refLogItem: any;
  let logOutput: string = '';

  if (logging) log.open();

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
      let {name, processes, cmd, graph} = profile;
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

      if (!processMatched && !usePerformancePriorities && profile.default) processMatched = true;

      if (processMatched || usePerformancePriorities || isFullscreenOptimized) {
        if (profile.if) {
          let useCondition = false;

          switch (profile.if.condition) {
            case 'running':
              for (let i = 0, len = processList.length; i < len; i++) {
                processList[i]

                if (profile.if.forProcesses.indexOf(processList[i].name) > -1) {
                  useCondition = true;
                  if (logging) conditionReason = `${processList[i].name} is running`;
                }
              }
              break;
            case 'fullscreenOverrideActive':
              if (appConfig.fullscreenPriority && isValidActiveFullscreenApp) {
                // if 'forProcesses' is defined, only consider the listed applications as valid fullscreen apps.
                if (profile.if.forProcesses && profile.if.forProcesses.indexOf(activeProcess.name) === -1) {
                  break;
                }

                useCondition = true;
                if (logging) conditionReason = `Active process '${activeProcess.name}' is fullscreen`;
              }
              break;
          }

          if (useCondition) {
            let shouldContinue = false;

            switch (true) {
              // disable (skip) rule enforcement
              case (profile.if.then === 'disable'):
                shouldContinue = isDisabled = true;
                break;
              // replace rule
              case (typeof profile.if.then === 'object'):
                isReplacedBy = profile.if.then.name ? profile.if.then.name : 'override';
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
              [/* processAffinity */, systemAffinity] = getProcessorAffinity(pid);

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

          if (suspensionDelay = profile.suspensionDelay) {
            refLogItem.suspensionDelay = suspensionDelay;
          }

          if (resumeDelay = profile.resumeDelay) {
            refLogItem.resumeDelay = resumeDelay;
          }

          if (terminationDelay = profile.terminationDelay) {
            refLogItem.terminationDelay = terminationDelay;
          }

          if (affinity = profile.affinity) {
            refLogItem.affinityName = profile.affinityName;
            refLogItem.graph = graph;
          }

          if (cpuPriority = profile.cpuPriority) {
            refLogItem.cpuPriority = cpuPriorityMap[cpuPriority.toString()];
          }

          if (pagePriority = profile.pagePriority) {
            refLogItem.pagePriority = pagePriorityMap[pagePriority.toString()];
          }

          if (ioPriority = profile.ioPriority) {
            refLogItem.ioPriority = ioPriorityMap[ioPriority.toString()];
          }
        }
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
  }

  if (logging) {
    // Build the logging sequence
    for (let i = 0, len = logItems.length; i < len; i++) {
      let logItem = logItems[i];
      let {affected, graph, isDisabled, isReplacedBy, conditionReason} = logItem;
      let keys = Object.keys(logItem);
      let failed = [];

      logOutput +=
        `${EOL}${isDisabled ? '[DISABLED] ' : isReplacedBy ? `[OVERRIDDEN: ${isReplacedBy}] ` : ''}${logItem.name} -> `;

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
    log.info('fullscreenOptimizedPid:', fullscreenOptimizedPid);
    log.info('=========================================================');
    log.close();
  }

  timeout = setTimeout(runRoutine, interval);
};

const init = () => {
  // Lower the priority of wincontrol to idle
  setPriorityClass(process.pid, cpuPriorityMap.idle);

  log.info('====================== Config info ======================');
  log.info(`Configuration file: ${appConfigYamlPath}`);
  log.info(`Environment: ${isDevelopment ? 'development' : 'production'}`);
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
      [fullAffinity, ] = getAffinityForCoreRanges([[0, physicalCoreCount - 1]], useHT, coreCount);
      return fs.ensureDir(appDir);
    })
    .then(() => fs.ensureDir(logDir))
    .then(() => fs.exists(appConfigYamlPath))
    .then((exists) => {
      if (!exists) return copyFile('./config.yaml', appConfigYamlPath);
      return Promise.resolve();
    })
    .then(() => fs.exists(appConfigTaskXMLPath))
    .then((exists) => {
      if (!exists) return installTaskSchedulerTemplate(appConfigTaskXMLPath);
      return Promise.resolve();
    })
    .then(() => readYamlFile(appConfigYamlPath))
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
          fullscreenPriority: true,
          ignoreProcesses: [],
          profiles: [],
          affinities: []
        };
      }

      log.enabled = config.logging;
      log.enableConsoleLog = config.consoleLogging;

      if (isDevelopment) {
        log.enabled = log.enableConsoleLog = config.logging = config.consoleLogging = true;
        config.logLevel = 'info';
      }

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
