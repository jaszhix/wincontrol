// @ts-nocheck
import {EOL} from 'os';
import {loadConfiguration, parseProfilesConfig, resetGlobals} from './index';

import {
  getActiveWindow,
  getProcessorAffinity,
  setProcessorAffinity,
  getPriorityClass,
  setPriorityClass,
  getPagePriority,
  setPagePriority,
  getIOPriority,
  setIOPriority,
  terminateProcess,
  suspendProcess,
  resumeProcess,
} from './nt';
import {exc, getAffinityForCoreRanges, readYamlFile} from './utils';
import {coreCount, PSPriorityMap, pagePriorityMap, ioPriorityMap} from './constants';

// Don't let existing instances affect tests
beforeAll(async () => {
  try {
    await exc('powershell "Stop-Process -Name wincontrol"');
  } catch (e) {}
});

afterAll(async () => {
  try {
    await exc('powershell "Stop-Process -Name notepad"');
  } catch (e) {}
});

afterEach(resetGlobals);

test('parseProfilesConfig: can parse profiles', async (done) => {
  const appConfig = await readYamlFile('./test/valid.yaml');
  const parser = jest.fn(parseProfilesConfig);

  parser(appConfig);

  expect(parser).toHaveBeenCalledTimes(1);

  expect(appConfig.profiles[0].name).toBe('servicesPriorityOnlyLow');
  expect(appConfig.profiles[0].affinity).toBe(16383);
  expect(appConfig.profiles[0].cpuPriority).toBe(16384);
  expect(appConfig.profiles[0].pagePriority).toBe(5);
  expect(appConfig.profiles[0].ioPriority).toBe(1);
  expect(appConfig.profiles[0].graph).toBe(
    '[ 0| 1| 2| 3| 4| 5| 6| 7| 8| 9|10|11|12|13|--|--|--|--|--|--|--|--|--|--|--|--|--|--]'
  );

  done();
});

test('parseProfilesConfig: throws if the \'if\' property does not have an array value', async (done) => {
  const appConfig = await readYamlFile('./test/invalidIf.yaml');
  const parser = jest.fn(parseProfilesConfig);

  expect(() => {
    parser(appConfig);
  }).toThrowError(/'if' block misconfiguration: 'if' should be an array of conditional objects/);

  done();
});

test('parseProfilesConfig: throws if there are duplicate profile names', async (done) => {
  const appConfig = await readYamlFile('./test/duplicateProfileNames.yaml');
  const parser = jest.fn(parseProfilesConfig);

  expect(() => {
    parser(appConfig);
  }).toThrowError(/Misconfiguration found - the 'name' property must be a unique identifier/);

  done();
});

test('parseProfilesConfig: throws if a process is configured in multiple profiles', async (done) => {
  const appConfig = await readYamlFile('./test/duplicateProcessHandling.yaml');
  const parser = jest.fn(parseProfilesConfig);

  expect(() => {
    parser(appConfig);
  }).toThrowError(/Misconfiguration found - the process 'steam' is either duplicated in a profile or handled in multiple profiles/);

  done();
});

test('parseProfilesConfig: throws if a profile is missing a \'processes\' property, and \'cmd\' is undefined', async (done) => {
  const appConfig = await readYamlFile('./test/missingProcessesProperty.yaml');
  const parser = jest.fn(parseProfilesConfig);

  expect(() => {
    parser(appConfig);
  }).toThrowError(/Misconfiguration found - missing required property 'processes'/);

  done();
});

test('getAffinityForCoreRanges: converts 2D arrays of core ranges to Windows compatible affinity values', () => {
  let [affinity, graph] = getAffinityForCoreRanges([[0, 13]], true, 28);

  expect(affinity).toBe(268435455);
  expect(graph).toBe('[ 0| 1| 2| 3| 4| 5| 6| 7| 8| 9|10|11|12|13]');

  [affinity, graph] = getAffinityForCoreRanges([[0, 12]], true, 28);

  expect(affinity).toBe(134209535);
  expect(graph).toBe('[ 0| 1| 2| 3| 4| 5| 6| 7| 8| 9|10|11|12|--]');

  [affinity, graph] = getAffinityForCoreRanges([[0, 1], [11, 13]], true, 28);

  expect(affinity).toBe(234944515);
  expect(graph).toBe('[ 0| 1|--|--|--|--|--|--|--|--|--|11|12|13]');

  [affinity, graph] = getAffinityForCoreRanges([[10]], true, 28);

  expect(affinity).toBe(16778240);
  expect(graph).toBe('[--|--|--|--|--|--|--|--|--|--|10|--|--|--]');

  [affinity, graph] = getAffinityForCoreRanges([[0, 3], [6, 9], [12, 13]], true, 28);

  expect(affinity).toBe(217314255);
  expect(graph).toBe('[ 0| 1| 2| 3|--|--| 6| 7| 8| 9|--|--|12|13]');

  // Logical core affinity
  [affinity, graph] = getAffinityForCoreRanges([[0, 3], [6, 9], [12, 13]], false, 28);

  expect(affinity).toBe(13263);
  expect(graph).toBe('[ 0| 1| 2| 3|--|--| 6| 7| 8| 9|--|--|12|13|--|--|--|--|--|--|--|--|--|--|--|--|--|--]');

  [affinity, graph] = getAffinityForCoreRanges([[0, 3]], false, 4);

  expect(affinity).toBe(15);
  expect(graph).toBe('[ 0| 1| 2| 3]');

  [affinity, graph] = getAffinityForCoreRanges([[0, 3]], false, 8);

  expect(affinity).toBe(15);
  expect(graph).toBe('[ 0| 1| 2| 3|--|--|--|--]');

  [affinity, graph] = getAffinityForCoreRanges([[0, 3]], true, 8);

  expect(affinity).toBe(255);
  expect(graph).toBe('[ 0| 1| 2| 3]');
});

const testAffinity = async (ranges) => {
  let pid = parseInt(await exc('powershell "(Start-Process notepad -passthru).ID"'));
  let [affinity, graph] = getAffinityForCoreRanges(ranges, true, coreCount);

  console.log(graph);

  let success = setProcessorAffinity(pid, affinity);

  expect(success).toBe(true);

  let actualAffinity = parseInt(
    (await exc(`powershell "Get-Process -Id ${pid} | Select-Object ProcessorAffinity"`))
    .match(/\d+/g)[0]
  );

  expect(actualAffinity).toBe(affinity);

  let [processAffinity, systemAffinity] = getProcessorAffinity(pid);

  expect(actualAffinity).toBe(processAffinity);

  return await exc(`powershell "Stop-Process -Id ${pid}"`);
}

test('setProcessorAffinity: can set processor affinity', async (done) => {
  await testAffinity([[0, Math.max(1, Math.round(coreCount / 2))]]);
  await testAffinity([[0, Math.max(1, Math.round(coreCount / 4))]]);
  await testAffinity([[0, Math.max(1, Math.round(coreCount / 6))]]);
  await testAffinity([[0, Math.max(1, Math.round(coreCount / 8))]]);

  done();
});

const testCPUPriority = async (priority: string) => {
  let pid = parseInt(await exc('powershell "(Start-Process notepad -passthru).ID"'));

  let success = setPriorityClass(pid, PSPriorityMap[priority]);

  expect(success).toBe(true);

  let actualCPUPriority = (await exc(`powershell "Get-Process -Id ${pid} | Select-Object PriorityClass"`))
    .match(/(Idle|BelowNormal|Normal|AboveNormal|High|RealTime)/g)[0]

  expect(actualCPUPriority).toBe(priority);

  expect(getPriorityClass(pid)).toBe(PSPriorityMap[priority]);

  return await exc(`powershell "Stop-Process -Id ${pid}"`);
}

test('setPriorityClass: can set CPU priority, and be retrieved with getPriorityClass', async (done) => {
  await testCPUPriority('Idle');
  await testCPUPriority('BelowNormal');
  await testCPUPriority('Normal');
  await testCPUPriority('AboveNormal');
  await testCPUPriority('High');
  await testCPUPriority('RealTime');

  done();
});

const testPagePriority = async (priority: string) => {
  let pid = parseInt(await exc('powershell "(Start-Process notepad -passthru).ID"'));

  let success = setPagePriority(pid, pagePriorityMap[priority]);

  expect(success).toBe(true);

  let actualPagePriority = getPagePriority(pid);

  expect(actualPagePriority).toBe(pagePriorityMap[priority]);

  return await exc(`powershell "Stop-Process -Id ${pid}"`);
}

test('setPagePriority: can set page priority, and be retrieved with getPagePriority', async (done) => {
  await testPagePriority('idle');
  await testPagePriority('low');
  await testPagePriority('medium');
  await testPagePriority('belowNormal');
  await testPagePriority('normal');

  done();
});

const testIOPriority = async (priority: string) => {
  let pid = parseInt(await exc('powershell "(Start-Process notepad -passthru).ID"'));

  let success = setIOPriority(pid, ioPriorityMap[priority]);

  expect(success).toBe(true);

  let actualIOPriority = getIOPriority(pid);

  expect(actualIOPriority).toBe(ioPriorityMap[priority]);

  return await exc(`powershell "Stop-Process -Id ${pid}"`);
}

test('setIOPriority: can set IO priority, and be retrieved with getIOPriority', async (done) => {
  await testIOPriority('idle');
  await testIOPriority('low');
  await testIOPriority('normal');

  done();
});

test('terminateProcess: can terminate process', async (done) => {
  let pid = parseInt(await exc('powershell "(Start-Process notepad -passthru).ID"'));
  let success = terminateProcess(pid);
  let notepadRunning = false;

  expect(success).toBe(true);

  try {
    await exc(`powershell "Get-Process -Id ${pid}"`);
    notepadRunning = true;
  } catch (e) {/* non-zero exit code from process not running */}

  expect(notepadRunning).toBe(false);

  done();
});

test('suspendProcess: can suspend process', async (done) => {
  let pid = parseInt(await exc('powershell "(Start-Process notepad -passthru).ID"'));
  let success = suspendProcess(pid);

  expect(success).toBe(true);

  let threads = (await exc(`powershell "(Get-Process -Id ${pid}).Threads"`)).split(EOL);

  for (let i = 0, len = threads.length; i < len; i++) {
    let [key, value] = threads[i].split(':');

    if (key.trim() === 'WaitReason') {
      expect(value.trim()).toBe('Suspended');
    }
  }

  await exc(`powershell "Stop-Process -Id ${pid}"`);

  done();
});

test('resumeProcess: can resume process', async (done) => {
  let pid = parseInt(await exc('powershell "(Start-Process notepad -passthru).ID"'));
  let success = suspendProcess(pid);

  expect(success).toBe(true);

  success = resumeProcess(pid);

  expect(success).toBe(true);

  let threads = (await exc(`powershell "(Get-Process -Id ${pid}).Threads"`)).split(EOL);
  let validWaitReasons = [
    'UserRequest',
    'EventPairLow'
  ];

  for (let i = 0, len = threads.length; i < len; i++) {
    let [key, value] = threads[i].split(':');

    if (key.trim() === 'WaitReason') {
      expect(validWaitReasons.includes(value.trim())).toBe(true);
    }
  }

  await exc(`powershell "Stop-Process -Id ${pid}"`);

  done();
});

test('getActiveWindow: can detect top foreground window', async (done) => {
  let pid = parseInt(await exc('powershell "(Start-Process notepad -passthru).ID"'));

  setTimeout(async () => {
    let activeWindow = getActiveWindow();

    expect(activeWindow.pid).toBe(pid);

    await exc(`powershell "Stop-Process -Id ${pid}"`);

    done();
  }, 1000);
});

// TODO: Find an environment-agnostic way to test core affinities from the config
test('fallback priorities are enforced', async (done) => {
  let pid = parseInt(await exc('powershell "(Start-Process notepad -passthru).ID"'));

  // Reset this process' CPU and IO priorities to normal to ensure a baseline.
  setPriorityClass(pid, PSPriorityMap.Normal);

  let actualCPUPriority = (await exc(`powershell "Get-Process -Id ${pid} | Select-Object PriorityClass"`))
    .match(/(Idle|BelowNormal|Normal|AboveNormal|High|RealTime)/g)[0]

  expect(actualCPUPriority).toBe('Normal');

  setIOPriority(pid, ioPriorityMap.normal);

  let actualIOPriority = getIOPriority(pid);

  expect(actualIOPriority).toBe(ioPriorityMap.normal);

  await loadConfiguration('./test/fallbackPrioritiesAreEnforced.yaml');

  setTimeout(async () => {
    actualCPUPriority = (await exc(`powershell "Get-Process -Id ${pid} | Select-Object PriorityClass"`))
      .match(/(Idle|BelowNormal|Normal|AboveNormal|High|RealTime)/g)[0]

    expect(actualCPUPriority).toBe('BelowNormal');

    actualIOPriority = getIOPriority(pid);

    expect(actualIOPriority).toBe(ioPriorityMap.low);

    done();
  }, 1000);
});

test('alternate profile guarded by the active condition is correctly toggled', async (done) => {
  let pid = parseInt(await exc('powershell "(Start-Process notepad -passthru).ID"'));
  let cmdPid;

  let actualAffinity, actualCPUPriority, actualIOPriority, actualPagePriority;
  let [singleCore, ] = getAffinityForCoreRanges([[0]], true, coreCount);
  let [dualCore, ] = getAffinityForCoreRanges([[0, 1]], true, coreCount);

  await loadConfiguration('./test/activeProcessCondition.yaml');

  actualAffinity = parseInt(
    (await exc(`powershell "Get-Process -Id ${pid} | Select-Object ProcessorAffinity"`))
    .match(/\d+/g)[0]
  );
  actualCPUPriority = (await exc(`powershell "Get-Process -Id ${pid} | Select-Object PriorityClass"`))
    .match(/(Idle|BelowNormal|Normal|AboveNormal|High|RealTime)/g)[0]
  actualIOPriority = getIOPriority(pid);
  actualPagePriority = getPagePriority(pid);

  expect(actualAffinity).toBe(dualCore);
  expect(actualCPUPriority).toBe('Normal');
  expect(actualIOPriority).toBe(ioPriorityMap.normal);
  expect(actualPagePriority).toBe(pagePriorityMap.normal);

  // Stop the timeout loop
  resetGlobals();

  // Unfocus notepad by launching a cmd.exe window, which will gain focus.
  // notepad should now be enforced by the alternate profile in the 'if' block guarded by the active condition.
  cmdPid = parseInt(await exc('powershell "(Start-Process cmd -passthru).ID"'));

  await loadConfiguration('./test/activeProcessCondition.yaml');

  actualAffinity = parseInt(
    (await exc(`powershell "Get-Process -Id ${pid} | Select-Object ProcessorAffinity"`))
    .match(/\d+/g)[0]
  );
  actualCPUPriority = (await exc(`powershell "Get-Process -Id ${pid} | Select-Object PriorityClass"`))
    .match(/(Idle|BelowNormal|Normal|AboveNormal|High|RealTime)/g)[0]
  actualIOPriority = getIOPriority(pid);
  actualPagePriority = getPagePriority(pid);

  expect(actualAffinity).toBe(singleCore);
  expect(actualCPUPriority).toBe('Idle');
  expect(actualIOPriority).toBe(ioPriorityMap.idle);
  expect(actualPagePriority).toBe(pagePriorityMap.idle);

  await exc(`powershell "Stop-Process -Id ${cmdPid}"`);

  done();
});
