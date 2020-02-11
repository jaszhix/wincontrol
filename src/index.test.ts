import {parseProfilesConfig} from './index';

import {setProcessorAffinity} from './nt';
import {exc, getAffinityForCoreRanges, readYamlFile} from './utils';
import {coreCount} from './constants';

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
    (await exc('powershell "Get-Process notepad | Select-Object ProcessorAffinity"'))
    .match(/\d+/g)[0]
  );


  expect(affinity).toBe(actualAffinity);

  return await exc('powershell "Stop-Process -Name notepad"');
}

test('setProcessorAffinity: can set processor affinity', async (done) => {
  await testAffinity([[0, Math.max(1, Math.round(coreCount / 2))]]);
  await testAffinity([[0, Math.max(1, Math.round(coreCount / 4))]]);
  await testAffinity([[0, Math.max(1, Math.round(coreCount / 6))]]);
  await testAffinity([[0, Math.max(1, Math.round(coreCount / 8))]]);

  done();
});
