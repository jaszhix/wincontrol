import {EOL} from 'os';
import {parseProfilesConfig} from './index';

import {
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

test('parseProfilesConfig: can parse profiles', async (done) => {
  const appConfig = await readYamlFile('./test/config.yaml');
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

  done();
});

afterAll(async () => {
  try {
    await exc('powershell "Stop-Process -Name notepad"');
  } catch (e) {}
});
